#!/usr/bin/env node
'use strict';
/* Separate first-write-only cross-line 4-ticket live snapshots + settlement.
 * Uses published source BEFORE the race. Neither the existing router nor its bets change. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Feed=require('../js/race-feed.js');
const Risk=require('../js/mansha/risk.js');
require('../js/mansha/model.js');
const Model=globalThis.ManshaRiskModel;
const Cross=require('../js/crossline/selected.js');
const ROOT=path.resolve(__dirname,'..'),BASE='https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/';
const SCHEMA='tk-crossline-selected-history/v1';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const jstDate=now=>new Date(now+9*3600000).toISOString().slice(0,10);
const read=(p,d)=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):d;
function atomic(file,v){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(v)+'\n');fs.renameSync(file+'.tmp',file);}
function identity(r){return r.riders.map(x=>[x.no,String(x.meta?.rider_id||''),String(x.name).replace(/[\s\u3000]/g,'')]).sort((a,b)=>a[0]-b[0]);}
function models(root=ROOT){const raw=read(path.join(root,'reports/mansha/crossline-pair-third-v1.json'),{});if(!Cross.validWeights(raw.models))throw Error('従来別線4点の係数ファイルが不正です');return raw.models;}
function freeze(r,models,{now=Date.now()}={}){
 const start=Date.parse(r.date+'T'+r.start+':00+09:00'),updated=Date.parse(r.source?.generated_at);
 if(!Number.isFinite(start)||!Number.isFinite(updated)||updated>now||updated>=start||now>=start||
 r.source?.mode!=='live-public-feed')return null;
 const forecast=Cross.predict(r,models,Risk,Model);
 if(!['A7','C7'].includes(forecast.category))return null;
 if(forecast.candidate4.length!==4||new Set(forecast.candidate4).size!==4)throw Error('4点以外の予想');
 return {schema:SCHEMA,version:Cross.VERSION,race_id:[r.date,r.venue,r.race_no].join(':'),
  date:r.date,venue:r.venue,race_no:r.race_no,start:r.start,
  cutoff:new Date(start).toISOString(),saved_at:new Date(now).toISOString(),
  source_generated_at:r.source.generated_at,identity:identity(r),
  lineup:r.lineup.map(x=>x.slice()),forecast};
}
function capture(day,{root=ROOT,now=Date.now(),weights=models(root)}={}){
 const date=jstDate(now),info={date,feed_races:day?.races?.length||0,eligible:0,new:0,existing:0,late:0,invalid:0,errors:[]};
 if(day?.date!==date||!Array.isArray(day.races)||day.races.length>250||!(Date.parse(day.generated_at)<=now))throw Error('配信日または時刻が不正');
 const folder=path.join(root,'data/crossline_selected',date);
 for(const raw of day.races){
  if(raw.is_girls||raw.entries?.length!==7||raw.entries.some(x=>/^L/.test(String(x.class_rank))))continue;
  const ranks=raw.entries.map(e=>String(e.class_rank));
  if(!(ranks.every(x=>/^A[123]$/.test(x))))continue;
  info.eligible++;
  try{
   const id=[date,raw.venue,raw.race_number].join(':');
   const file=path.join(folder,hash(id)+'.json');
   if(fs.existsSync(file)){info.existing++;continue;}
   const r=Feed.convert(raw,day),snap=freeze(r,weights,{now});
   if(!snap){info.late++;continue;}
   fs.mkdirSync(folder,{recursive:true});
   try{fs.writeFileSync(file,JSON.stringify(snap)+'\n',{flag:'wx'});info.new++;}
   catch(e){if(e.code==='EEXIST')info.existing++;else throw e;}
  }catch(e){info.invalid++;info.errors.push({race_id:[date,raw.venue,raw.race_number].join(':'),reason:String(e.message||e).slice(0,180)});}
 }
 return info;
}
function gradeEval(forecast,actual,now=Date.now()){
 if(!actual)return {status:'pending'};
 if(actual.accounting_hold)return {status:'excluded',reason:actual.accounting_hold};
 const expected=forecast.race_id,updated=Date.parse(actual.source_updated_at),collected=Date.parse(actual.collected_at),cutoff=Date.parse(forecast.cutoff);
 if(actual.race_id!==expected||actual.race?.start!==forecast.start||
 JSON.stringify(actual.identity)!==JSON.stringify(forecast.identity)||
 !Number.isFinite(updated)||updated<=cutoff||updated>now||
 !Number.isFinite(collected)||collected<updated)return {status:'excluded',reason:'結果の出走者・時刻・取得時点が不一致'};
 if(!Array.isArray(actual.combos)||actual.combos.length<1||
 actual.combos.some(c=>!Array.isArray(c.trio)||c.trio.length!==3||c.key!==c.trio.join('-')||
 !Number.isInteger(c.payout)||c.payout<=0))return {status:'pending',reason:'払戻未確定'};
 const won=tickets=>actual.combos.reduce((sum,c)=>sum+(tickets.includes(c.key)?c.payout:0),0);
 const all=forecast.forecast.candidate4,selected=forecast.forecast.tickets;
 if(all.length!==4||selected.length!==[0,4][Number(forecast.forecast.eligible)]||new Set(all).size!==4)return {status:'excluded',reason:'保存予想の点数が不正'};
 const payoutAll=won(all),payoutSelected=won(selected);
 const firstTwo=actual.combos.map(c=>c.trio.slice(0,2).join('-'));
 const pairHit=forecast.forecast.pairs.some(p=>firstTwo.includes(p.join('-')));
 return {status:'evaluated',actual:actual.combos.map(c=>({key:c.key,payout:c.payout})),pair_hit:pairHit,
  all4:{stake:400,payout:payoutAll,hit:payoutAll>0,net:payoutAll-400},
  selected4:{stake:selected.length*100,payout:payoutSelected,hit:payoutSelected>0,net:payoutSelected-selected.length*100}};
}
function totals(rows,mode){
 const done=rows.filter(r=>r.evaluation.status==='evaluated'),values=done.map(r=>r.evaluation[mode]).filter(Boolean),stake=values.reduce((a,b)=>a+b.stake,0),payout=values.reduce((a,b)=>a+b.payout,0);
 const sorted=values.slice().sort((a,b)=>b.payout-a.payout);
 const trim=n=>{const v=sorted.slice(0,n);const s=stake-v.reduce((a,b)=>a+b.stake,0);return s?(payout-v.reduce((a,b)=>a+b.payout,0))/s:null;};
 return {evaluated:done.length,selected:values.filter(v=>v.stake>0).length,pending:rows.filter(r=>r.evaluation.status==='pending').length,
  excluded:rows.filter(r=>r.evaluation.status==='excluded').length,hits:values.filter(v=>v.hit).length,stake,payout,net:payout-stake,
  roi:stake?payout/stake:null,trim1:trim(1),trim3:trim(3),trim5:trim(5)};
}
function report(root=ROOT,now=Date.now()){
 const base=path.join(root,'data/crossline_selected'),hist=path.join(root,'data/routed_history');
 const rows=[],errors=[];
 if(fs.existsSync(base))for(const day of fs.readdirSync(base).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)).sort()){
  const folder=path.join(base,day),results=read(path.join(hist,day,'results.json'),{});
  for(const f of fs.readdirSync(folder).filter(f=>/^[a-f0-9]{64}\.json$/.test(f))){
   try{
    const r=read(path.join(folder,f)),frozen=Date.parse(r.saved_at);
    if(r.schema!==SCHEMA||r.version!==Cross.VERSION||f!==hash(r.race_id)+'.json'||
      r.race_id!==[r.date,r.venue,r.race_no].join(':')||day!==r.date||
      !Number.isFinite(frozen)||frozen>=Date.parse(r.cutoff)||
      Date.parse(r.source_generated_at)>frozen)throw Error('発走前保存記録が不正');
    rows.push({...r,evaluation:gradeEval(r,results[r.race_id],now)});
   }catch(e){errors.push({date:day,file:f,reason:e.message});}
  }
 }
 const sum=x=>({all4:totals(x,'all4'),selected4:totals(x,'selected4')});
 const by=selector=>Object.fromEntries([...new Set(rows.map(selector))].sort().map(k=>[k,sum(rows.filter(r=>selector(r)===k))]));
 const evaluated=rows.filter(r=>r.evaluation.status==='evaluated'),selected=rows.filter(r=>r.forecast.eligible);
 return {schema:'tk-crossline-selected-evaluation/v1',version:Cross.VERSION,generated_at:new Date(now).toISOString(),
  note:'独立モデル。発走前に固定した予想のみ集計し、各点100円の仮想成績。購入・決済機能なし。',
  summary:{saved:rows.length,selected_saved:selected.length,eval:evaluated.length,
   pending:rows.filter(r=>r.evaluation.status==='pending').length,excluded:rows.filter(r=>r.evaluation.status==='excluded').length,
   errors:errors.length,views:sum(rows)},
  by_date:by(r=>r.date),by_category:by(r=>r.forecast.category),
  rows:rows.map(r=>({race_id:r.race_id,date:r.date,venue:r.venue,race_no:r.race_no,start:r.start,
   saved_at:r.saved_at,source_generated_at:r.source_generated_at,identity:r.identity,lineup:r.lineup,forecast:r.forecast,evaluation:r.evaluation})),
  errors};
}
async function fetchDay(date){
 const response=await fetch(BASE+date+'.json',{signal:AbortSignal.timeout(20000)});
 if(response.status===404)return null;
 if(!response.ok)throw Error('出走表HTTP '+response.status);
 const text=await response.text();if(text.length>8000000)throw Error('出走表サイズ超過');
 const day=JSON.parse(text);if(day.date!==date)throw Error('配信日不一致');return day;
}
async function run({root=ROOT,now=Date.now(),fetcher=fetchDay}={}){
 const date=jstDate(now);let fetched=null,error=null,captured=null;
 try{fetched=await fetcher(date);captured=fetched?capture(fetched,{root,now,weights:models(root)}):{date,feed:'not_published'};}
 catch(e){error=String(e.stack||e).slice(0,600);}
 const evaluation=report(root,now),base=path.join(root,'data/crossline_selected');
 atomic(path.join(base,'evaluation.json'),evaluation);
 atomic(path.join(base,'status.json'),{date,generated_at:new Date(now).toISOString(),capture:captured,error});
 console.log(JSON.stringify({capture:captured,error,summary:evaluation.summary}));
 return {capture:captured,error,evaluation};
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
module.exports={SCHEMA,models,freeze,capture,gradeEval,totals,report,run,hash,jstDate};
