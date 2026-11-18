#!/usr/bin/env node
'use strict';
/* Immutable independent 4/6/8/10 cross-line shadow; no purchases and no hindsight capture. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Feed=require('../js/race-feed.js'),Old=require('./crossline-selected-daily.cjs');
const Expanded=require('../js/crossline/expanded.js');
const ROOT=path.resolve(__dirname,'..'),SCHEMA='tk-crossline-expanded-shadow/v1';
const BASE='https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/';
const read=(f,defaultValue)=>fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):defaultValue;
const hash=s=>crypto.createHash('sha256').update(s).digest('hex')+'.json';
const jst=ms=>new Date(ms+9*3600000).toISOString().slice(0,10);
function write(f,value){
 fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f+'.tmp',JSON.stringify(value)+'\n');fs.renameSync(f+'.tmp',f);
}
function inputIdentity(r){return r.riders.map(x=>[x.no,String(x.meta?.rider_id||''),String(x.name).replace(/[\s\u3000]/g,'')]).sort((a,b)=>a[0]-b[0]);}
function freeze(r,baseline,weights,now=Date.now()){
 const start=Date.parse(r.date+'T'+r.start+':00+09:00'),source=Date.parse(r.source?.generated_at);
 if(r.source?.mode!=='live-public-feed'||!Number.isFinite(start)||!Number.isFinite(source)||
  source>now||source>=start||now>=start||!baseline||baseline.schema!==Old.SCHEMA||baseline.version!=='crossline-selected-v1-20261114')return null;
 const id=[r.date,r.venue,r.race_no].join(':'),baseSaved=Date.parse(baseline.saved_at),baseSource=Date.parse(baseline.source_generated_at);
 if(baseline.race_id!==id||!Number.isFinite(baseSaved)||baseSaved>=start||
  !Number.isFinite(baseSource)||baseSource>baseSaved||baseSaved>now||
  r.source.generated_at!==baseline.source_generated_at||
  JSON.stringify(baseline.identity)!==JSON.stringify(inputIdentity(r))||
  JSON.stringify(baseline.lineup)!==JSON.stringify(r.lineup))throw Error('Frozen original and current pre-race card disagree');
 const ext=Expanded.predict(r,weights);
 if(JSON.stringify(ext.variants['4'])!==JSON.stringify(baseline.forecast?.candidate4))throw Error('Frozen 4-point forecast mismatch');
 return {schema:SCHEMA,version:Expanded.VERSION,race_id:id,date:r.date,venue:r.venue,race_no:r.race_no,start:r.start,
  cutoff:new Date(start).toISOString(),saved_at:new Date(now).toISOString(),source_generated_at:r.source.generated_at,
  identity:inputIdentity(r),lineup:r.lineup,baseline,ordered_pairs:ext.ordered_pairs,variants:ext.variants};
}
function capture(day,{root=ROOT,now=Date.now(),weights=Old.models(root)}={}){
 const date=jst(now),stat={date,feed_races:day?.races?.length||0,eligible_in_feed:0,new:0,existing:0,baseline_missing:0,too_late:0,errors:[]};
 if(day?.date!==date||!Array.isArray(day.races)||day.races.length>250||Date.parse(day.generated_at)>now)throw Error('Published feed date or timestamp is invalid');
 for(const raw of day.races){
  if(raw.is_girls||raw.entries?.length!==7||raw.entries.some(x=>!/^A[123]$/.test(String(x.class_rank||''))))continue;
  stat.eligible_in_feed++;
  const id=[date,raw.venue,raw.race_number].join(':'),file=path.join(root,'data/crossline_expanded',date,hash(id));
  if(fs.existsSync(file)){stat.existing++;continue;}
  const baseline=read(path.join(root,'data/crossline_selected',date,hash(id)),null);
  if(!baseline){stat.baseline_missing++;continue;}
  try{
   const r=Feed.convert(raw,day),s=freeze(r,baseline,weights,now);
   if(!s){stat.too_late++;continue;}
   fs.mkdirSync(path.dirname(file),{recursive:true});
   try{fs.writeFileSync(file,JSON.stringify(s)+'\n',{flag:'wx'});stat.new++;}
   catch(e){if(e.code==='EEXIST')stat.existing++;else throw e;}
  }catch(e){stat.errors.push({race_id:id,reason:String(e.message||e).slice(0,180)});}
 }
 return stat;
}
function grade(s,actual,now=Date.now()){
 const base=Old.gradeEval(s.baseline,actual,now);
 if(base.status!=='evaluated')return base;
 const values={};
 for(const count of Expanded.COUNTS){
  const tickets=s.variants[String(count)],payout=base.actual.reduce((sum,c)=>sum+(tickets.includes(c.key)?c.payout:0),0);
  values[String(count)]={stake:count*100,payout,net:payout-count*100,hit:payout>0};
 }
 if(values['4'].payout!==base.all4.payout) return {status:'excluded',reason:'Original 4-point payout does not match'};
 return {status:'evaluated',actual:base.actual,values};
}
function aggregate(rows){
 const valid=rows.filter(r=>r.evaluation.status==='evaluated'),result={races:rows.length,evaluated:valid.length,
  pending:rows.filter(r=>r.evaluation.status==='pending').length,excluded:rows.filter(r=>r.evaluation.status==='excluded').length,variants:{}};
 for(const count of Expanded.COUNTS){
  const values=valid.map(r=>r.evaluation.values[String(count)]),stake=values.reduce((s,v)=>s+v.stake,0),
   payout=values.reduce((s,v)=>s+v.payout,0),wins=values.filter(v=>v.hit).length;
  const sorted=values.slice().sort((a,b)=>b.payout-a.payout);
  const trim=n=>{const kept=sorted.slice(Math.min(n,sorted.length));const cost=kept.reduce((s,v)=>s+v.stake,0);return cost?kept.reduce((s,v)=>s+v.payout,0)/cost:null;};
  result.variants[String(count)]={races:valid.length,hits:wins,stake,payout,net:payout-stake,roi:stake?payout/stake:null,trim1:trim(1),trim3:trim(3)};
 }
 return result;
}
function groups(rows){
 return {selected:aggregate(rows.filter(r=>r.baseline.forecast.eligible)),skipped:aggregate(rows.filter(r=>!r.baseline.forecast.eligible)),all:aggregate(rows)};
}
function report(root=ROOT,now=Date.now()){
 const base=path.join(root,'data/crossline_expanded'),history=path.join(root,'data/routed_history'),rows=[],errors=[];
 if(fs.existsSync(base))for(const date of fs.readdirSync(base).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)).sort()){
  const results=read(path.join(history,date,'results.json'),{}),folder=path.join(base,date);
  for(const f of fs.readdirSync(folder).filter(x=>/^[a-f0-9]{64}\.json$/.test(x))){
   try{
    const s=read(path.join(folder,f),null),saved=Date.parse(s.saved_at);
    if(s.schema!==SCHEMA||s.version!==Expanded.VERSION||s.date!==date||hash(s.race_id)!==f||
      !Number.isFinite(saved)||saved>=Date.parse(s.cutoff)||Date.parse(s.source_generated_at)>saved||
      JSON.stringify(s.variants['4'])!==JSON.stringify(s.baseline?.forecast?.candidate4)||
      Expanded.COUNTS.some((n,i)=>!Array.isArray(s.variants[String(n)])||s.variants[String(n)].length!==n||
       new Set(s.variants[String(n)]).size!==n||(i>0&&JSON.stringify(s.variants[String(n)].slice(0,Expanded.COUNTS[i-1]))!==JSON.stringify(s.variants[String(Expanded.COUNTS[i-1])]))))
      throw Error('Invalid first-write research record');
    rows.push({...s,evaluation:grade(s,results[s.race_id],now)});
   }catch(e){errors.push({date,file:f,reason:String(e.message||e)});}
  }
 }
 const project=r=>({race_id:r.race_id,date:r.date,venue:r.venue,race_no:r.race_no,start:r.start,
  saved_at:r.saved_at,eligible:r.baseline.forecast.eligible,reason:r.baseline.forecast.reason,
  risk_percent:r.baseline.forecast.risk?.percent,ordered_pairs:r.ordered_pairs,variants:r.variants,evaluation:r.evaluation});
 const dates=[...new Set(rows.map(r=>r.date))];
 return {schema:'tk-crossline-expanded-evaluation/v1',version:Expanded.VERSION,generated_at:new Date(now).toISOString(),
  scope:'Forward-only frozen original 4-point cohort. 4/6/8/10 same pre-race pairs; skip scenarios are hypothetical, 100 yen per ticket. No betting.',
  summary:groups(rows),by_date:Object.fromEntries(dates.map(d=>[d,groups(rows.filter(r=>r.date===d))])),
  rows:rows.map(project).sort((a,b)=>b.date.localeCompare(a.date)||a.start.localeCompare(b.start)||a.venue.localeCompare(b.venue,'ja')),errors};
}
async function fetchDay(date){
 const response=await fetch(BASE+date+'.json',{signal:AbortSignal.timeout(20000)});
 if(response.status===404)return null;
 if(!response.ok)throw Error('Published feed HTTP '+response.status);
 const text=await response.text();if(text.length>8000000)throw Error('Published feed too large');
 const day=JSON.parse(text);if(day.date!==date)throw Error('Feed date mismatch');return day;
}
async function run({root=ROOT,now=Date.now(),fetcher=fetchDay}={}){
 const date=jst(now);let captureResult=null,error=null;
 try{const d=await fetcher(date);captureResult=d?capture(d,{root,now,weights:Old.models(root)}):{date,feed:'not_published'};}
 catch(e){error=String(e.stack||e).slice(0,700);}
 const evaluation=report(root,now),dir=path.join(root,'data/crossline_expanded');
 write(path.join(dir,'evaluation.json'),evaluation);
 write(path.join(dir,'status.json'),{date,generated_at:new Date(now).toISOString(),capture:captureResult,error});
 console.log(JSON.stringify({capture:captureResult,error,summary:evaluation.summary}));
 return {capture:captureResult,error,evaluation};
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={SCHEMA,freeze,capture,grade,aggregate,groups,report,run,hash,jst};
