#!/usr/bin/env node
'use strict';
/* Current B-AXIS v0.6 retrospective 5-day shard, 2026-08-18..2026-11-15.
 * The frozen, public historical source may have been updated after the race.
 * Input whitelist has NO result, AI mark, payout or betting odds. Same fixed 5745 source races as eight-engine report.
 * All source/day SHA-256 digests checked. This never places a bet or touches production.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Feed=require('../js/race-feed.js'),LineInput=require('../js/line/input.js');
const BAxis=require('../js/b-axis/engine.js'),Audit=require('../js/results-audit.js'),Eval=require('../js/b-upset/evaluation.cjs');
const SOURCE_SHA='4588ec938a2fec9e81216d3fd3423329805aa3d5';
const dir=path.resolve(__dirname,'../reports/year-race-type');
const audit=JSON.parse(fs.readFileSync(path.join(dir,'complete90-eight-engine-audit.json'),'utf8'));
if(audit.schema!=='tk-keirin-90day-exhaustive-fullrace-eight-engine-report/v1'||
 audit.races?.length!==5745||audit.source?.pinned_commit!==SOURCE_SHA)throw Error('Fixed 5745-race audit mismatch');
const shard=Number(process.env.YEAR_BAXIS_SHARD);
if(!Number.isInteger(shard)||shard<0||shard>=18)throw Error('Shard must be 0..17');
const allDates=Array.from({length:90},(_,i)=>new Date(Date.parse('2026-08-18T00:00:00Z')+i*86400000).toISOString().slice(0,10));
const dates=allDates.slice(shard*5,shard*5+5),dateSet=new Set(dates);
const expected=new Map(audit.races.filter(x=>dateSet.has(x.date)).map(x=>[x.race_id,x]));
if(expected.size!==audit.races.filter(x=>dateSet.has(x.date)).length)throw Error('Duplicate historical audit ID');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function day(date){
 const url='https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/'+SOURCE_SHA+'/'+date+'.json';
 for(let i=0;i<3;i++)try{
  const response=await fetch(url,{headers:{'User-Agent':'tk-keirin-lab-b-axis-retro-verified'},signal:AbortSignal.timeout(40000)});
  if(!response.ok)throw Error('HTTP '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer()),sha256=digest(bytes),data=JSON.parse(bytes.toString('utf8'));
  if(data.date!==date||!Array.isArray(data.races)||sha256!==audit.source.day_sha256[date])throw Error('Frozen archive digest/date mismatch '+date);
  return {date,data,sha256};
 }catch(e){if(i===2)throw e;await new Promise(ok=>setTimeout(ok,(i+1)*700))}
}
const asOf=(date,start)=>Date.parse(date+'T'+start+':00+09:00')-600000;
function clean(source){
 return {
  venue:String(source.venue),race_number:Number(source.race_number),start_time:String(source.start_time),
  round_name:String(source.round_name||''),grade:String(source.grade||''),is_girls:false,
  entries:source.entries.map(e=>({
   car_number:e.car_number,rider_id:e.rider_id,rider_name:e.rider_name,rider_full_name:e.rider_full_name,
   class_rank:e.class_rank,running_style:e.running_style,line_position:e.line_position,
   age:e.age,prefecture:e.prefecture,competition_score:e.competition_score,term:e.term
  }))
 };
}
function proxy(raw){
 const mean=raw.riders.reduce((s,x)=>s+x.score,0)/raw.riders.length;
 const arr=raw.lineup.map((line,i)=>{
  const first=raw.riders.find(r=>r.no===line[0]);
  const follower=line.length>1?raw.riders.find(r=>r.no===line[1]):null;
  if(!first||!['逃','両','追'].includes(first.style))throw Error('Invalid head');
  const b=({逃:2,両:1,追:-.8})[first.style]+.035*(first.score-mean)+.30*(Math.min(3,line.length)-1)+ (follower?.score-mean||0)*.007;
  const power=first.score+(follower?.score>mean?.4*(follower.score-mean):0)+.4*(line.length-1);
  return{head:first.no,style:first.style,group:line,score_b:b,score_power:power};
 });
 const ranking=[...arr].sort((x,y)=>y.score_b-x.score_b||raw.riders.find(z=>z.no===y.head).score-raw.riders.find(z=>z.no===x.head).score||x.head-y.head);
 const strongest=[...arr].sort((x,y)=>y.score_power-x.score_power||raw.riders.find(z=>z.no===y.head).score-raw.riders.find(z=>z.no===x.head).score||x.head-y.head)[0];
 return{head:ranking[0].head,group:ranking[0].group,nonfavorite:ranking[0].head!==strongest.head,
  margin:Math.round((ranking[0].score_b-ranking[1].score_b)*10000)/10000,
  group_count:ranking.length,escape_count:arr.filter(x=>x.style==='逃').length};
}
function settle(keys,obs){
 const x=Eval.settle(keys,obs);
 return{stake:x.stake,payout:x.payout,points:x.points,hit:x.hit,net:x.net};
}
async function main(){
 const days=await Promise.all(dates.map(day)),lookup=new Map();
 for(const d of days)for(const s of d.data.races){
  const key=d.date+':'+s.venue+':'+s.race_number;
  if(lookup.has(key))throw Error('Duplicate race in archive '+key);
  lookup.set(key,{source:s,day:d.data});
 }
 const rows=[],failures={};let incomplete=0;
 for(const [rid,original] of [...expected].sort((a,b)=>a[0].localeCompare(b[0]))){
  const pair=lookup.get(rid);
  if(!pair)throw Error('Original 8-way eligible race vanished '+rid);
  try{
   const {source,day:srcDay}=pair;
   if(source.is_girls||source.entries.length!==original.cars||source.round_name!==original.round)throw Error('Source identity mismatch');
   const inputRaw=Feed.convert(clean(source),{date:original.date,generated_at:''});
   inputRaw.source={mode:'historical-archive-replay',generated_at:'',verified:false,
    label:'Pinned archive pre-result fields only',missing_fields:['historical_b','historical_s','recent','ex','published_at']};
   // Explicit rejection of any possible post-race field leaking into predictor.
   if('result_top3' in inputRaw||'result_combos' in inputRaw||
       'predictions' in inputRaw||'payout_trifecta' in inputRaw)throw Error('Result leaked into input');
   const bInput=LineInput.prepare(inputRaw,{},asOf(original.date,inputRaw.start));
   if('result_top3' in bInput.race||'result_combos' in bInput.race||'payout_trifecta' in bInput.race)throw Error('Result leak after preparation');
   const simple=proxy(inputRaw);
   const b=BAxis.build(bInput,{limit:10});
   const head=b.bCandidates[0]?.no;
   if(!Number.isInteger(head)||!inputRaw.riders.some(x=>x.no===head)||b.tickets.some(x=>!inputRaw.riders.some(r=>r.no===x.trio[0])))
      throw Error('No valid B-axis forecast');
   const observed=Audit.result(source,srcDay,new Date().toISOString());
   if(!observed||!observed.combos?.length)throw Error('Original outcome missing');
   if(observed.race_id!==rid)throw Error('Result identity changed');
   const candidates=b.bCandidates.slice(0,3).map(x=>({no:x.no,support:x.support}));
   const tickets=b.tickets.map(x=>x.key);
   const settlement={};
   for(const n of [3,5,10])settlement['baxis_'+n]=settle(tickets.slice(0,n),observed);
   rows.push({id:rid,date:original.date,cars:original.cars,category:original.category,
    meeting_day:original.meeting_day,stage:original.stage,venue:original.venue,
    b_axis_head:head,proxy_head:simple.head,agreement:head===simple.head,
    proxy_nonfavorite:simple.nonfavorite,proxy_margin:simple.margin,
    b_axis_top_support:candidates[0]?.support??null,b_axis_second_support:candidates[1]?.support??null,
    b_axis_margin:candidates.length>1?Number((candidates[0].support-candidates[1].support).toFixed(2)):null,
    b_axis_tickets_count:tickets.length,model_version:b.version,
    projected_first_head_wins:observed.combos.some(x=>x.trio[0]===head),
    projected_first_line_wins:observed.combos.some(x=>simple.group.includes(x.trio[0])),
    settlement});
  }catch(e){const k=e.message;failures[k]=(failures[k]||0)+1;incomplete++;}
  if(rows.length%80===0&&rows.length)console.log('BAXIS_REPLAY_PROGRESS',shard,rows.length,'/',expected.size);
 }
 const out={schema:'tk-keirin-90day-baxis-v06-shard/v1',shard,dates,source_commit:SOURCE_SHA,
  source_day_sha256:Object.fromEntries(days.map(x=>[x.date,x.sha256])),
  model:BAxis.VERSION,expected:expected.size,completed:rows.length,incomplete,failures,
  caveat:'CURRENT 2026-11 model retrospective replay; insufficient B/S/EX historical statistics; archive timestamp not independently pre-race.',
  rows};
 fs.mkdirSync(path.join(dir,'baxis90-shards'),{recursive:true});
 fs.writeFileSync(path.join(dir,'baxis90-shards','part-'+shard+'.json'),JSON.stringify(out)+'\n');
 console.log('BAXIS90_SHARD_DONE',JSON.stringify({shard,n:rows.length,expected:expected.size,failed:incomplete,examples:Object.entries(failures).slice(0,8)}));
 if(rows.length!==expected.size)process.exitCode=2;
}
main().catch(e=>{console.error(e);process.exitCode=1});
