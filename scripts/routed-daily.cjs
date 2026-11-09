'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const Feed=require('../js/race-feed.js'),Policy=require('../js/routing/policy.js'),Audit=require('../js/results-audit.js'),Eval=require('../js/routing/evaluation.js');
const root=path.resolve(__dirname,'..'),defaultDir=path.join(root,'data/routed_history');
const read=(file,fallback)=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fallback;
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value)+'\n');fs.renameSync(file+'.tmp',file);};
const name=id=>crypto.createHash('sha256').update(id).digest('hex')+'.json';
const jstDate=(now,offset=0)=>new Date(now+9*3600000+offset*86400000).toISOString().slice(0,10);
// Each forecast run can pick up the latest result window if a scheduled run was delayed.
function resultSlot(now){
 const today=jstDate(now),yesterday=jstDate(now,-1);
 for(const [day,time,raceDate] of [
  [today,'18:08',today],
  [today,'05:28',yesterday],
  [today,'00:28',yesterday],
  [yesterday,'18:08',yesterday]
 ]){
  const at=Date.parse(day+'T'+time+':00+09:00');
  if(at<=now)return {at,raceDate};
 }
}
// Result checks are limited to one attempt per hour when the public feed is late.
const RESULT_RETRY_MS=60*60000;
function shouldSettle(now,status){
 const slot=resultSlot(now),done=Date.parse(status.last_result_slot);
 if(Number.isFinite(done)&&done>=slot.at)return false;
 const attempted=Date.parse(status.last_result_attempt_at);
 return !(status.last_result_attempt_slot===new Date(slot.at).toISOString()&&
  Number.isFinite(attempted)&&now-attempted>=0&&now-attempted<RESULT_RETRY_MS);
}
function packs(){const out={};for(const [key,file] of Object.entries({intelligence:'intelligence.json',recent:'recent_form.json',material:'race_material.json',s:'s_counts.json',conditions:'line_conditions.json',ex:'ex_approved/latest.json'})){
 const p=read(path.join(root,'data',file),{});if(key!=='ex'||p.license_status==='approved-for-model-and-publication'&&p.redistribution_approved===true)out[key]=p;
 }return out;}
function predict(race,packs){
 const p=spawnSync(process.execPath,[path.join(__dirname,'routed-predict.cjs')],{input:JSON.stringify({race,packs}),encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});
 if(p.error)throw p.error;if(p.status!==0)throw Error((p.stderr||'予想処理エラー').slice(-300));return JSON.parse(p.stdout);
}
function save(record,dir){
 if(record.requested!=='auto'||Eval.evaluate(record).status!=='pending')throw Error('自動保存予想の検証に失敗');
 const file=path.join(dir,record.out.race.date,name(record.race_id));fs.mkdirSync(path.dirname(file),{recursive:true});
 try{fs.writeFileSync(file,JSON.stringify({...record,origin:'scheduled_auto',run_id:process.env.GITHUB_RUN_ID||null})+'\n',{flag:'wx'});return true;}catch(e){if(e.code==='EEXIST')return false;throw e;}
}
function ingest(day,dir,pack,{now=()=>Date.now(),build=predict,freeze=true,capture=true,settle=true}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day?.date)||!Array.isArray(day.races)||day.races.length>250||!Number.isFinite(Date.parse(day.generated_at))||Date.parse(day.generated_at)>now())throw Error('配信日・更新時刻・レース一覧が不正');
 const folder=path.join(dir,day.date),manifest=read(path.join(folder,'coverage.json'),{date:day.date,races:[]}),previous=new Map(manifest.races.map(r=>[r.race_id,r]));
 const results=read(path.join(folder,'results.json'),{}),seen=new Set();let saved=0;const errors=[],resultErrors=[];
 const ids=day.races.map(s=>`${day.date}:${s.venue}:${Number(s.race_number)}`);if(new Set(ids).size!==ids.length)throw Error('配信内に同一レースが重複');
 for(const s of day.races.slice().sort((a,b)=>String(a.start_time).localeCompare(String(b.start_time)))){
  if(s.is_girls||s.entries?.some(e=>/^L/.test(String(e.class_rank)))||![7,9].includes(s.entries?.length))continue;
  const id=`${day.date}:${s.venue}:${Number(s.race_number)}`;
  if(seen.has(id))throw Error('配信内に同一レースが重複');seen.add(id);
  const row={...(previous.get(id)||{}),race_id:id,date:day.date,venue:s.venue,race_no:Number(s.race_number),start:s.start_time,cars:s.entries.length};
  try{
   if(settle){
    const holds=s.cancelled===true||s.is_cancelled===true||/^(cancelled|canceled|abandoned|中止|不成立)$/i.test(s.race_status||s.status||'')?'中止・不成立のため集計除外':s.refunds?.length||s.refunded_cars?.length||s.payouts?.refund?.length?'返還があるため精算対象外':null;
    if(holds)results[id]={accounting_hold:holds};else{try{const observed=Audit.result(s,day,new Date(now()).toISOString());if(observed)results[id]=observed;}catch(e){results[id]={accounting_hold:'結果の訂正内容を検証できない：'+e.message};resultErrors.push({race_id:id,error:e.message});throw e;}}
   }
   if(!capture)continue;
   const selection=Policy.select({class:String(s.round_name||''),riders:s.entries.map(e=>({meta:{rank:e.class_rank}}))});row.engine=selection.engine;row.label=selection.label;row.category=selection.category.key;
   const r=Feed.convert(s,day);
   const file=path.join(folder,name(id));
   if(fs.existsSync(file)){row.capture='saved';delete row.error;}
   else if(now()>=Audit.startAt(r)){row.capture='missed';delete row.error;}
   else if(freeze){const record=build(r,pack);if(record.race_id!==id||!(Date.parse(record.saved_at)<=now()))throw Error('保存レース・時刻が不一致');if(save(record,dir))saved++;row.capture='saved';delete row.error;}
   else row.capture='pending_capture';
  }catch(e){row.capture=fs.existsSync(path.join(folder,name(id)))?'saved':'error';row.error=e.message;errors.push({race_id:id,error:e.message});}
  previous.set(id,row);
 }
 if(settle)write(path.join(folder,'results.json'),results);
 if(capture)write(path.join(folder,'coverage.json'),{date:day.date,source_updated_at:day.generated_at,checked_at:new Date(now()).toISOString(),races:[...previous.values()].sort((a,b)=>a.race_id.localeCompare(b.race_id))});
 return {date:day.date,source_updated_at:day.generated_at,eligible:seen.size,saved,errors,result_errors:resultErrors};
}
function report(dir,now=Date.now()){
 const rows=[],errors=[];
 for(const date of fs.existsSync(dir)?fs.readdirSync(dir).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)).sort():[]){
  const folder=path.join(dir,date),coverage=read(path.join(folder,'coverage.json'),{races:[]}),results=read(path.join(folder,'results.json'),{}),cards=new Map(coverage.races.map(r=>[r.race_id,r]));
  for(const f of fs.readdirSync(folder).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)))try{
   const rec=read(path.join(folder,f)),o=rec.out,id=rec.race_id;if(name(id)!==f||!id.startsWith(date+':'))throw Error('保存ファイル名が不一致');
   const evaluation=Eval.evaluate(rec,results[id]),r=o.race;cards.delete(id);
   rows.push({race_id:id,date,venue:r.venue,race_no:r.race_no,start:r.start,engine:o.selection.engine,label:o.selection.label,category:o.selection.category.key,model_id:rec.model_id,policy_version:rec.policy_version,saved_at:rec.saved_at,input_sha256:rec.input_sha256,output_sha256:rec.output_sha256,tickets:o.tickets.map(t=>t.key),result:results[id]?.combos||[],record:date+'/'+f,evaluation});
  }catch(e){errors.push({date,file:f,error:e.message});}
  for(const c of cards.values())rows.push({...c,evaluation:{status:c.capture==='error'?'error':now>=Date.parse(`${date}T${c.start}:00+09:00`)?'missed':'pending_capture',category:c.error||'発走前予想の保存なし'}});
 }
 return {schema:'tk-keirin-routed-evaluation/v1',generated_at:new Date(now).toISOString(),stake_per_ticket:100,scope:'男子7車・9車。自動選択の最初の発走前保存を各100円で評価。手動切替・発走後再現は含めない。',summary:Eval.summarize(rows),by_date:Eval.group(rows,r=>r.date),by_engine:Eval.group(rows,r=>r.engine||'取得不可'),by_category:Eval.group(rows,r=>r.category||'級班不明'),by_model:Eval.group(rows,r=>[r.policy_version||'未保存',r.model_id||'未保存'].join(' / ')),rows,errors};
}
async function fetchDay(date){const url='https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/'+date+'.json';const res=await fetch(url,{signal:AbortSignal.timeout(20000)});if(res.status===404)return null;if(!res.ok)throw Error('HTTP '+res.status);const body=await res.text();if(body.length>8000000)throw Error('配信サイズ超過');const day=JSON.parse(body);if(day.date!==date)throw Error('配信日が不一致');return day;}
async function collect({dir=defaultDir,fetcher=fetchDay,now=()=>Date.now(),build=predict,capture=true,settle=true,scheduled=false,pack=capture?packs():{}}={}){
 const started=now(),statusFile=path.join(dir,'status.json');
 const previousStatus=read(statusFile,{});
 const slot=resultSlot(started),slotStamp=new Date(slot.at).toISOString();
 let lastResultSlot=previousStatus.last_result_slot||null;
 let lastResultAttemptAt=previousStatus.last_result_attempt_at||null;
 let lastResultAttemptSlot=previousStatus.last_result_attempt_slot||null;
 let lastResultCompleteAt=previousStatus.last_result_complete_at||null;
 let lastResultCheck=previousStatus.last_result_check||null;
 if(scheduled)settle=shouldSettle(started,previousStatus);
 if(settle){lastResultAttemptAt=new Date(started).toISOString();lastResultAttemptSlot=slotStamp;}
 const dates=new Set(Array.from({length:settle?8:capture?1:0},(_,i)=>jstDate(started,-i))),errors=[],collections=[];
 // Retry older unsettled results as well; bound each run's network requests.
 if(settle){
 const prior=report(dir,started);for(const date of [...new Set(prior.rows.filter(r=>['pending','awaiting_payout'].includes(r.evaluation.status)).map(r=>r.date))].sort().slice(0,24))dates.add(date);
 }
 const boundedBuild=(r,p)=>{if(now()-started>15*60000)throw Error('処理時間の上限に達したため次回に再試行');return build(r,p);};
 for(const date of [...dates].sort().reverse())try{if(date!==jstDate(started)&&!fs.existsSync(path.join(dir,date)))continue;const day=await fetcher(date);if(day)collections.push(ingest(day,dir,pack,{now,build:boundedBuild,freeze:date===jstDate(now()),capture,settle}));else collections.push({date,feed:'not_available'});}catch(e){errors.push({date,error:e.message});}
 const evaluation=report(dir,now());
 if(settle){
  const source=collections.find(c=>c.date===slot.raceDate),sourceTime=Date.parse(source?.source_updated_at);
  // A fresh feed timestamp alone does not mean that its race results were published.
  // Only races that had enough time to finish at the checkpoint must be settled.
  const mature=evaluation.rows.filter(r=>r.date===slot.raceDate&&r.saved_at&&
   Date.parse(`${r.date}T${r.start}:00+09:00`)<=slot.at-45*60000);
  const unresolved=mature.filter(r=>!['evaluated','excluded'].includes(r.evaluation.status));
  // Overnight rechecks should not wait forever for a feed timestamp to change
  // if all finished races already have independently validated settlement records.
  const lastMatureStart=Math.max(...mature.map(r=>Date.parse(`${r.date}T${r.start}:00+09:00`)));
  const fresh=Number.isFinite(sourceTime)&&(sourceTime>=slot.at-60*60000||
   (mature.length>0&&unresolved.length===0&&sourceTime>lastMatureStart));
  const failed=errors.some(e=>e.date===slot.raceDate)||(source?.result_errors?.length||0)>0;
  const complete=fresh&&!failed&&unresolved.length===0;
  if(complete){lastResultSlot=slotStamp;lastResultCompleteAt=new Date(now()).toISOString();}
  lastResultCheck={slot:slotStamp,race_date:slot.raceDate,state:failed?'source_error':!source?'source_missing':!fresh?'source_stale':unresolved.length?'results_pending':'complete',
   source_updated_at:source?.source_updated_at||null,mature:mature.length,unresolved:unresolved.length,
   evaluated:evaluation.rows.filter(r=>r.date===slot.raceDate&&r.evaluation.status==='evaluated').length};
 }
 write(path.join(dir,'evaluation.json'),evaluation);
 write(statusFile,{last_result_slot:lastResultSlot,last_result_attempt_at:lastResultAttemptAt,last_result_attempt_slot:lastResultAttemptSlot,
  last_result_complete_at:lastResultCompleteAt,last_result_check:lastResultCheck,
  started_at:new Date(started).toISOString(),generated_at:new Date(now()).toISOString(),run_id:process.env.GITHUB_RUN_ID||null,collections,errors});
 console.log(JSON.stringify({summary:evaluation.summary,result_check:lastResultCheck,collections,errors}));return evaluation;
}
if(require.main===module)collect({capture:!process.argv.includes('--results-only'),settle:!process.argv.includes('--forecasts-only'),scheduled:process.argv.includes('--scheduled')}).catch(e=>{console.error(e);process.exitCode=1;});module.exports={ingest,save,report,collect,predict,name,jstDate,resultSlot,shouldSettle};
