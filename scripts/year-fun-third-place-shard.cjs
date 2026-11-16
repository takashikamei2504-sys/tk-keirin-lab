#!/usr/bin/env node
'use strict';
/** "Rational × irrational" research only: 90d frozen source SHA, prediction first, settle later.
 * All simulated whimsical third-place tickets are added only if truly new and valid.
 * Cost-matched placebo for #6; cost-neutral swap of last original ticket also tested.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Feed=require('../js/race-feed.js'),Router=require('../js/routing/router.js');
const B=require('../js/b-upset/engine.cjs'),Audit=require('../js/results-audit.js'),E=require('../js/b-upset/evaluation.cjs');
const ROOT=path.resolve(__dirname,'../reports/year-race-type');
const SHA='4588ec938a2fec9e81216d3fd3423329805aa3d5';
const SHARD=Number(process.env.FUN_SHARD);
if(!Number.isInteger(SHARD)||SHARD<0||SHARD>=18)throw Error('FUN_SHARD must be 0..17');
const audit=JSON.parse(fs.readFileSync(path.join(ROOT,'complete90-eight-engine-audit.json'),'utf8'));
const baxis=JSON.parse(fs.readFileSync(path.join(ROOT,'baxis90-shards','part-'+SHARD+'.json'),'utf8'));
if(audit.races?.length!==5745||audit.source?.pinned_commit!==SHA||
 baxis.schema!=='tk-keirin-90day-baxis-v06-shard/v1'||baxis.shard!==SHARD||
 baxis.incomplete!==0||baxis.completed!==baxis.expected)throw Error('Historical fixed source/feature mismatch');
const correct=new Map([['2026-08-22:松戸:3|line',180],['2026-08-22:松戸:3|roi_coverage',180],['2026-08-26:玉野:6|b_upset_ad',1590]]);
const allDates=Array.from({length:5},(_,i)=>new Date(Date.parse('2026-08-18T00:00:00Z')+(SHARD*5+i)*86400000).toISOString().slice(0,10));
const dates=new Set(allDates),expected=new Map(audit.races.filter(x=>dates.has(x.date)).map(x=>[x.race_id,x]));
const bFeatures=new Map(baxis.rows.map(x=>[x.id,x]));
if(bFeatures.size!==expected.size||bFeatures.size!==baxis.expected)throw Error('B-axis features incomplete');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const digestInt=s=>parseInt(hash(s).slice(0,12),16);
async function fetchDate(date){
 const uri='https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/'+SHA+'/'+date+'.json';
 for(let attempt=0;attempt<3;attempt++)try{
  const response=await fetch(uri,{headers:{'User-Agent':'tk-keirin-lab-fun-research'},signal:AbortSignal.timeout(40000)});
  if(!response.ok)throw Error('Historical HTTP '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer()),doc=JSON.parse(bytes.toString('utf8'));
  if(doc.date!==date||!Array.isArray(doc.races)||hash(bytes)!==audit.source.day_sha256[date]||
    hash(bytes)!==baxis.source_day_sha256[date])throw Error('Historical source SHA mismatch');
  return doc;
 }catch(e){if(attempt===2)throw e;await new Promise(resolve=>setTimeout(resolve,700*(attempt+1)))}
}
function sourceWhitelist(source){
 return{venue:source.venue,race_number:source.race_number,start_time:source.start_time,
 round_name:source.round_name,grade:source.grade,is_girls:false,
 entries:source.entries.map(e=>({car_number:e.car_number,rider_id:e.rider_id,rider_name:e.rider_name,
  rider_full_name:e.rider_full_name,class_rank:e.class_rank,running_style:e.running_style,
  line_position:e.line_position,age:e.age,prefecture:e.prefecture,
  competition_score:e.competition_score,term:e.term}))};
}
function settle(keys,observed){
 const v=E.settle(keys,observed);
 return{s:v.stake,p:v.payout,n:v.points};
}
const cleanKey=t=>typeof t==='string'?t:t.key;
function variants(keys,raw,rid,depth){
 const starters=raw.riders.map(x=>x.no).sort((a,b)=>a-b);
 const base=new Set(keys),pairs=[];
 for(const key of keys){
  const parts=key.split('-').map(Number),id=parts.slice(0,2).join('-');
  if(!pairs.some(x=>x.id===id))pairs.push({id,first:parts[0],second:parts[1]});
  if(pairs.length>=depth)break;
 }
 const run=(name,fn)=>{
  const x=[];
  for(const q of pairs){
   const eligible=starters.filter(n=>n!==q.first&&n!==q.second&&!base.has(q.id+'-'+n));
   const third=fn(q,eligible);
   if(third!==null&&eligible.includes(third))x.push(q.id+'-'+third);
  }
  return [...new Set(x)];
 };
 const out={};
 for(let n=1;n<=9;n++)out['digit_'+n]=run('digit_'+n,(_,e)=>e.includes(n)?n:null);
 out.date_digit=run('date_digit',(q,e)=>{
  if(!e.length)return null;
  const day=Number(raw.date.slice(-2)),idx=(day+raw.race_no)%starters.length;
  return starters.slice(idx).concat(starters.slice(0,idx)).find(n=>e.includes(n))??null;
 });
 out.random=run('random',(q,e)=>e.length?e[digestInt(rid+'|'+q.id+'|rand-v1')%e.length]:null);
 out.lowest_score=run('lowest_score',(q,e)=>{
  const riders=raw.riders.filter(r=>e.includes(r.no)).sort((a,b)=>a.score-b.score||a.no-b.no);
  return riders[0]?.no??null;
 });
 out.outside_line=run('outside_line',(q,e)=>{
  const a=raw.lineup.find(l=>l.includes(q.first))||[],b=raw.lineup.find(l=>l.includes(q.second))||[];
  const outside=e.filter(n=>!a.includes(n)&&!b.includes(n));
  if(!outside.length)return null;
  return raw.riders.filter(r=>outside.includes(r.no)).sort((x,y)=>x.score-y.score||x.no-y.no)[0]?.no??null;
 });
 // Paired digit 6 versus uniformly random non-6 alternative, exactly same first-2 and investment count.
 const matched6=[],matchedRandom=[];
 for(const q of pairs){
  const eligible=starters.filter(n=>n!==q.first&&n!==q.second&&!base.has(q.id+'-'+n));
  const options=eligible.filter(n=>n!==6);
  if(eligible.includes(6)&&options.length){
   matched6.push(q.id+'-6');
   matchedRandom.push(q.id+'-'+options[digestInt(rid+'|'+q.id+'|matched6')%options.length]);
  }
 }
 out.matched6=matched6;out.matched_random6=matchedRandom;
 if(out.matched6.length!==out.matched_random6.length)throw Error('Matched placebo count mismatch');
 return{extras:out,pairs,starters};
}
function swaps(keys,extras){
 const last=keys.at(-1),fixed=keys.slice(0,-1);
 if(!last||!extras?.length)return null;
 const added=extras[0];
 if(keys.includes(added)||fixed.includes(added))return null;
 return[...fixed,added];
}
async function main(){
 const sourceDays=await Promise.all(allDates.map(fetchDate)),sourceIndex=new Map();
 for(const day of sourceDays)for(const x of day.races){
  const id=day.date+':'+x.venue+':'+x.race_number;
  if(sourceIndex.has(id))throw Error('Duplicate archive race '+id);
  sourceIndex.set(id,{card:x,day});
 }
 const rows=[],failed={};
 for(const [rid,o] of [...expected].sort((a,b)=>a[0].localeCompare(b[0]))){
  try{
   const record=sourceIndex.get(rid),b=bFeatures.get(rid);
   if(!record||!b)throw Error('Missing original source identity');
   const {card,day}=record;
   if(card.is_girls||card.entries.length!==o.cars||card.round_name!==o.round)throw Error('Card identity mismatch');
   const raw=Feed.convert(sourceWhitelist(card),{date:o.date,generated_at:''});
   raw.source.mode='historical-archive-replay';raw.source.generated_at='';
   if('result_top3' in raw||'result_combos' in raw||'payout_trifecta' in raw||'odds' in raw)throw Error('Outcome/odds leakage into predictor');
   const asOf=Date.parse(o.date+'T'+raw.start+':00+09:00')-600000;
   const auto=Router.build(raw,{}, {asOf,engine:'auto'});
   const upset=B.build(raw,{asOf,replay:true});
   if(auto.race_id!==rid||upset.race_id!==rid)throw Error('Prediction identity mismatch');
   const observed=Audit.result(card,day,new Date().toISOString());
   if(!observed||observed.race_id!==rid||observed.combos.some(t=>!(t.payout>0)))throw Error('No verified settlement');
   const original={
    auto:auto.tickets.map(cleanKey),
    upset:upset.research.ad.map(cleanKey)
   };
   for(const [name,keys] of Object.entries(original)){
    if((name==='auto'&&!keys.length)||new Set(keys).size!==keys.length)throw Error('Invalid or duplicated baseline tickets '+name);
    const expectedSettlement=o.predictions[name==='auto'?'auto':'b_upset_ad'];
    const got=settle(keys,observed),delta=correct.get(rid+'|'+(name==='auto'?'auto':'b_upset_ad'))||0;
    if(got.s!==expectedSettlement.stake||got.p!==expectedSettlement.payout+delta)throw Error('Original settlement disagreement '+name);
   }
   const baseSettled=Object.fromEntries(Object.entries(original).map(([name,keys])=>[name,settle(keys,observed)]));
   const additions={},swapsOut={};
   for(const [name,keys] of Object.entries(original)){
    for(const depth of [1,2]){
     const v=variants(keys,raw,rid,depth);
     for(const [kind,extrakeys] of Object.entries(v.extras)){
      const label=name+'|'+depth+'|'+kind;
      additions[label]=settle(extrakeys,observed);
     }
     // Equal-stake "replace last base ticket" only for top-pair experiments.
     if(depth===1)for(const kind of ['digit_6','digit_7','matched6','matched_random6','random','lowest_score','date_digit']){
      const target=swaps(keys,v.extras[kind]);
      if(target){
       swapsOut[name+'|'+kind]={enabled:true,base:baseSettled[name],replaced:settle(target,observed)};
      }
     }
    }
   }
   rows.push({id:rid,date:o.date,cars:o.cars,category:o.category,stage:o.stage,meeting:o.meeting_day,
    agreement:!!b.agreement,nonfavorite:!!b.proxy_nonfavorite,
    line_count:raw.lineup.length,base:baseSettled,add:additions,swap:swapsOut,
    deadheat:observed.combos.length>1});
  }catch(e){const key=e.message;failed[key]=(failed[key]||0)+1;}
 }
 const file={schema:'tk-keirin-rational-irrational-3rd-add-shard/v1',
  shard:SHARD,date_start:allDates[0],date_end:allDates[4],source:SHA,
  expected:expected.size,completed:rows.length,failures:failed,
  limitation:'November 2026 current-model replay of historical cards, pre-race capture time not proven; raw outcome excluded from prediction.',
  rows};
 fs.mkdirSync(path.join(ROOT,'fun-third-shards'),{recursive:true});
 fs.writeFileSync(path.join(ROOT,'fun-third-shards','part-'+SHARD+'.json'),JSON.stringify(file)+'\n');
 console.log('FUN_THIRD_SHARD_DONE',JSON.stringify({shard:SHARD,expected:expected.size,done:rows.length,failures:failed}).slice(0,1500));
 if(rows.length!==expected.size||Object.keys(failed).length)process.exitCode=2;
}
main().catch(e=>{console.error(e);process.exitCode=1});
