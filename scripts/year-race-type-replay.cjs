#!/usr/bin/env node
'use strict';
/**
 * Reproduce existing engines on the *same* historical race cards.
 * Historical replay only; do not label results as time-frozen predictions.
 * Model inputs: source entries, line order, grade and race identifiers ONLY.
 * Settlements: stored trifecta results, used only after predictions.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Feed=require('../js/race-feed.js');
const Policy=require('../js/routing/policy.js');
const Router=require('../js/routing/router.js');
const B=require('../js/b-upset/engine.cjs');
const Audit=require('../js/results-audit.js');
const Eval=require('../js/b-upset/evaluation.cjs');
const BASE='https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/';
const START=process.env.FINAL_START||'2026-08-18';
const END=process.env.FINAL_END||'2026-11-15';
const MAX=Number(process.env.FINAL_MAX??200);
const OFFSET=Number(process.env.FINAL_OFFSET??0);
const STAGE_CAP=Number(process.env.FINAL_STAGE_CAP??75);
const FILE=process.env.FINAL_REPORT_NAME||'year-race-type-part.json';
if(!/^[a-zA-Z0-9._-]+\.json$/.test(FILE))throw Error('Invalid report filename');
const HOLDOUT='2026-10-01';
const WAYS=['auto','physical','causal','lab_v5','line','roi_coverage','b_upset_ad','b_upset_expanded'];
const stageFor=(round,meetingDay)=>{
 if(/準決勝|準々決勝|二次予選|一次予選|予選|勝ち上がり|勝上/.test(round))return '勝ち上がり戦';
 if(/決勝/.test(round))return '決勝';
 if(meetingDay==='初日'&&/初日特選|特選|特別選抜|特別優秀/.test(round))return '初日特選';
 if(/一般|特一般|選抜|特選|特秀|特優|特別優秀|敗者|順位決定/.test(round))return '敗者戦';
 return 'その他';
};
const days=(a,b)=>{const out=[];for(let t=Date.parse(a+'T00:00Z');t<=Date.parse(b+'T00:00Z');t+=86400000)out.push(new Date(t).toISOString().slice(0,10));return out};
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const get=async date=>{
 for(let attempt=0;attempt<3;attempt++)try{
  const resp=await fetch(BASE+date+'.json',{signal:AbortSignal.timeout(20000),headers:{'user-agent':'TK-Keirin-Research'}});
  if(resp.status===404)return {date,missing:true};
  if(!resp.ok)throw Error('HTTP '+resp.status);
  const body=await resp.json();
  if(body.date!==date||!Array.isArray(body.races))throw Error('Invalid archive day');
  return {date,body};
 }catch(e){
  if(attempt===2)return {date,error:String(e).slice(0,160)};
  await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
 }
};
const queue=async ds=>{
 let i=0;const results=[];
 await Promise.all(Array.from({length:6},async()=>{
  while(i<ds.length){const date=ds[i++];results.push(await get(date))}
 }));
 return results.sort((a,b)=>a.date.localeCompare(b.date));
};
function asTicket(keys,result) {
 const unique=[...new Set(keys.filter(x=>/^[1-9]-[1-9]-[1-9]$/.test(x)))];
 return Eval.settle(unique,result);
}
function metric(rows){
 return Eval.metrics(rows);
}
function summary(rows){
 const compare=Object.fromEntries(WAYS.map(name=>[name,metric(rows.map(r=>r.predictions[name]).filter(Boolean))]));
 return {races:rows.length,complete:rows.filter(r=>WAYS.every(n=>r.predictions[n])).length,engines:compare};
}
function sections(rows){
 const by=(key)=>Object.fromEntries([...new Set(rows.map(key))].sort().map(k=>[k,summary(rows.filter(r=>key(r)===k))]));
 const common=rows.filter(r=>WAYS.every(n=>r.predictions[n]));
 return {
  available_case:summary(rows),
  complete_case:summary(common),
  known_stages_case:summary(common.filter(r=>r.stage!=='その他')),
  by_period:by(r=>r.date<HOLDOUT?'development_before_oct':'holdout_oct_nov'),
  by_cars:by(r=>String(r.cars)),
  by_grade:by(r=>r.category),
  by_grade_round:by(r=>r.category+'|'+r.round),
  by_grade_stage:by(r=>r.category+'|'+r.stage),
  by_stage:by(r=>r.stage),
  by_meeting_day:by(r=>r.meeting_day),
  by_partition:by(r=>r.partition),
  by_partition_grade:by(r=>r.partition+'|'+r.category),
  by_partition_grade_round:by(r=>r.partition+'|'+r.category+'|'+r.round),
  by_round:by(r=>r.round),
  by_month:by(r=>r.date.slice(0,7))
 };
}
async function main(){
 if(!Number.isInteger(MAX)||MAX<0||MAX>5000)throw Error('FINAL_MAX must be 0..5000');
 if(!Number.isInteger(OFFSET)||OFFSET<0||OFFSET>5000)throw Error('FINAL_OFFSET must be 0..5000');
 const inventory=days(START,END),all=await queue(inventory),missing=[],errors=[],exclusions={};
 const count=reason=>{exclusions[reason]=(exclusions[reason]||0)+1;};
 const cards=[],seen=new Set(),rounds={};
 for(const day of all){
  if(day.missing){missing.push(day.date);continue}
  if(day.error){errors.push({date:day.date,error:day.error});continue}
  for(const source of day.body.races){
   const meeting_day=String(day.body.venue_info?.[source.venue]?.meeting_day||'不明');
   const round=String(source.round_name||'').replace(/[\s\u3000]/g,'');
   rounds[round]=(rounds[round]||0)+1;
   const stage=stageFor(round,meeting_day);
   if(source.is_girls||source.entries?.some(e=>/^L/.test(e.class_rank||''))){count('girls');continue}
   if(![7,9].includes(source.entries?.length)){count('not_7_or_9');continue}
   if(source.cancelled||source.is_cancelled||source.refunds?.length||source.refunded_cars?.length){count('cancel_or_refund');continue}
   try{
    const raw=Feed.convert(source,{date:day.date,generated_at:''});
    // Historical cards may have been refreshed after the race: NEVER treat as
    // a contemporaneously captured prediction.
    raw.source.mode='historical-archive-replay';
    raw.source.generated_at='';
    const category=Policy.classify(raw).key;
    const observed=Audit.result(source,day.body,new Date().toISOString());
    if(!observed||observed.combos.some(c=>!Number.isInteger(c.payout)||c.payout<=0)){count('no_verified_payout');continue}
    const race_id=observed.race_id;
    if(seen.has(race_id)){count('duplicate_race');continue}
    seen.add(race_id);
    cards.push({race_id,date:day.date,venue:source.venue,race_no:Number(source.race_number),round,meeting_day,stage,category,cars:source.entries.length,raw,observed});
   }catch(e){count('invalid_card_or_result:'+String(e.message).slice(0,70))}
  }
 }
 // Outcome-blind stratified sampling by class and program stage; never select by payout.
 cards.sort((a,b)=>hash(a.race_id+'|year-race-type-v1').localeCompare(hash(b.race_id+'|year-race-type-v1')));
 const counts=new Map(),strata={};
 const selected=cards.filter(r=>{
  const k=r.category+'|'+r.stage;
  const c=counts.get(k)||0;
  if(c>=STAGE_CAP)return false;
  counts.set(k,c+1);return true;
 });
 for(const [k,c] of counts)strata[k]=c;
 selected.forEach((r,i)=>{r.partition='exploratory';r.sample_rank=i;});
 const sample=MAX?selected.slice(OFFSET,OFFSET+MAX):selected.slice(OFFSET);
 sample.sort((a,b)=>(a.date+a.venue+String(a.race_no).padStart(2,'0')).localeCompare(b.date+b.venue+String(b.race_no).padStart(2,'0')));
 const rows=[],failures={};const fail=(key,e)=>{(failures[key]??={count:0,examples:[]}).count++;if(failures[key].examples.length<3)failures[key].examples.push(String(e).slice(0,230))};
 for(const card of sample){
  const at=Date.parse(card.date+'T'+card.raw.start+':00+09:00')-600000;
  const predictions={}; const models={};
  for(const name of WAYS.filter(n=>!n.startsWith('b_upset'))){
   try{
    const out=Router.build(card.raw,{}, {asOf:at,engine:name});
    if(out.race_id!==card.race_id)throw Error('Race id mismatch');
    predictions[name]=asTicket(out.tickets.map(t=>t.key),card.observed);
    models[name]=out.model?.model_id||null;
   }catch(e){fail(name,e.message)}
  }
  try{
   const out=B.build(card.raw,{asOf:at,replay:true});
   if(out.race_id!==card.race_id)throw Error('B-UPSET race mismatch');
   predictions.b_upset_ad=asTicket(out.research.ad.map(t=>t.key),card.observed);
   predictions.b_upset_expanded=asTicket(out.research.expanded.map(t=>t.key),card.observed);
   models.b_upset_ad=out.model?.model_id||null;models.b_upset_expanded=models.b_upset_ad;
  }catch(e){fail('b_upset',e.message)}
  rows.push({race_id:card.race_id,date:card.date,venue:card.venue,race_no:card.race_no,round:card.round,meeting_day:card.meeting_day,stage:card.stage,category:card.category,cars:card.cars,partition:card.partition,sample_rank:card.sample_rank,
   predictions,models});
  if(rows.length%20===0)console.log('replayed',rows.length,'/',sample.length,'complete',rows.filter(r=>WAYS.every(n=>r.predictions[n])).length);
 }

 const report={
  schema:'tk-keirin-race-types-exploratory-replay/v1',generated_at:new Date().toISOString(),
  scope:{start:START,end:END,days:inventory.length,available_days:all.filter(x=>x.body).length,
   missing_days:missing,fetch_errors:errors,valid_races:cards.length,selected_total:selected.length,
   strata,shard_offset:OFFSET,shard_size:sample.length,stage_cap:STAGE_CAP,
   exclusion_counts:exclusions,round_counts:rounds,
   source:'public kurinaka12-afk/keirin-app-data archive; 2026-08-18 onwards'},
  methodologies:{input:'Historic entry basic cards plus public stated lineup; no 4-month form, B counts, comments or EX.',
   classification:'meeting_day from venue_info and actual round_name. Stage labels assigned before any result comparison.',
   predictions:'Current engine source replayed on historical public cards, NOT saved before race.',
   payouts:'100JPY per distinct trifecta ticket; public settled data not crosschecked to official.',
   strata:'At most '+STAGE_CAP+' races per category and stage selected by SHA256(race ID|year-race-type-v1) independent of result.',
   caveats:'Source limited to 2026-08-18 onwards. This is a preliminary 3-month slice and MUST NOT be labeled a 12-month test.'},
  engines:WAYS,stats:sections(rows),failures,
  races:rows.map(r=>({...r,predictions:Object.fromEntries(Object.entries(r.predictions).map(([key,val])=>[key,{points:val.points,stake:val.stake,payout:val.payout,hit:val.hit}]))}))
 };
 const dir=path.resolve(__dirname,'../reports/year-race-type');
 fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,FILE),JSON.stringify(report,null,2)+'\n');
 console.log('RESULT',JSON.stringify({scope:report.scope,stage:report.stats.by_grade_stage,failures:report.failures}).slice(0,15000));
}
main().catch(e=>{console.error(e);process.exitCode=1});
