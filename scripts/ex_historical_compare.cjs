'use strict';
/* Historical falsification test, research-only.
 * No official WINTICKET EX retrospective snapshots exist before 2026-11-08.
 * Test historical PUBLIC-RESULT-DERIVED condition categories instead, with
 * training dates strictly earlier than all target races.
 */
const fs=require('node:fs'),path=require('node:path');
const Brain=require('../js/race-brain.js');
const Ex=require('../js/ex-profile.js');
const ExDerivedContext=require('../js/b-axis/ex-context.js');
const Shadow=require('../js/ex-roi/shadow.cjs');
const History=require('./history-store.cjs');
const Audit=require('../js/roi/audit.cjs');
const source=path.join(__dirname,'../research/b-axis/ex_context_train_holdout_2026.json');
const x=JSON.parse(fs.readFileSync(source,'utf8'));
const base=path.join(__dirname,'../data/lab_history');
const minDate='2026-10-27',maxDate='2026-11-07';
const max=Number(process.argv[2]||160);
if(!(Number.isInteger(max)&&max>0&&max<=1000))throw Error('invalid max');
if(x.train_end_exclusive!=='2026-10-16'||x.training_start>'2026-10-15'||minDate<'2026-10-16'||x.provenance?.winticket_ex_metrics!==false)throw Error('training is not prior to holdout');
const population=x.splits?.train?.population||{},riders=x.splits?.train?.riders||{};
const clip=(a,mn=-1,mx=1)=>Math.max(mn,Math.min(mx,a));
let usedAxes={position:0,race_type:0,time_band:0,bank_length:0},usedRiders=0,modelChanged=0,unmatched=0,processed=0,errors=0;
const days=History.dates(base).filter(d=>d>=minDate&&d<=maxDate);
const results=[];
function feature(p,r,race){
 const id=String(r?.meta?.rider_id||'').replace(/^0+(?=\d)/,'');
 const features=riders[id],keys=Ex.selectionKeys(race,r);
 keys.time_band=ExDerivedContext.timeBand(race?.start);
 keys.bank_length=ExDerivedContext.bankLength(race?.ex_context?.track_length);
 if(!features)return p;
 const delta=[];
 for(const axis of ['position','race_type','time_band','bank_length']){
  const key=keys[axis],global=population?.[axis]?.[key],stat=features?.[axis]?.[key];
  if(!key||!(global?.n>=30)||!(stat?.n>=5))continue;
  const p0=(global.top3+3)/(global.n+6);
  const p1=(stat.top3+p0*24)/(stat.n+24);
  const signal=(p1-p0)*Math.min(1,stat.n/12);
  delta.push(signal);
  usedAxes[axis]++;p.measurements.push('過去着順由来の条件別 '+axis+':'+key+':'+stat.top3+'/'+stat.n);
 }
 if(delta.length){
  usedRiders++;
  // Only relative information already covered by the 2026-10-15 train window.
  // One averaged 3rd-place signal, never five correlated multipliers.
  const impact=clip(delta.reduce((a,b)=>a+b,0)/delta.length*.11,-.035,.035);
  p.finish=clip(p.finish+impact,.08,.92);
 }
 return p;
}
function sim(p,result){
 const original=Ex.attach;
 let baseOut,proxyOut;
 try{
  Ex.attach=(profile)=>profile;
  baseOut=Brain.build(p.input,{exAsOf:Date.parse(p.saved_at)});
  Ex.attach=feature;
  proxyOut=Brain.build(p.input,{exAsOf:Date.parse(p.saved_at)});
 }finally{Ex.attach=original;}
 const a=Shadow.select(baseOut),b=Shadow.select(proxyOut);
 if(a.length!==8||b.length!==8)throw Error('selection not 8');
 const settledA=Audit.settle({...p,chosen:a},result);
 const settledB=Audit.settle({...p,chosen:b},result);
 if(settledA.status!=='evaluated'||settledB.status!=='evaluated')return null;
 return {date:p.input.date,race_id:p.race_id,grade:settledA.grade,cars:settledA.cars,
  changed:!Shadow.diff(a,b).same,
  baseline:settledA,proxy:settledB,
  payout_diff:settledB.wins.reduce((s,n)=>s+n,0)-settledA.wins.reduce((s,n)=>s+n,0)};
}
for(const day of days){
 const history=History.load(base,day);
 const latest=new Map();
 for(const row of history.predictions){
  if(!Audit.validForecast(row)||day<='2026-10-15')continue;
  const old=latest.get(row.race_id);
  if(!old||Date.parse(row.saved_at)>Date.parse(old.saved_at))latest.set(row.race_id,row);
 }
 const outcomes=new Map(history.results.map(row=>[row.race_id,row]));
 for(const p of [...latest.values()].sort((a,b)=>a.race_id.localeCompare(b.race_id))){
  if(processed>=max)break;
  const truth=outcomes.get(p.race_id);
  if(!truth){unmatched++;continue;}
  try{
   const outcome=sim(p,truth);if(outcome){results.push(outcome);processed++;}else unmatched++;
  }catch(e){errors++;if(errors<=5)console.error('EX_PROXY_RACE_ERROR '+p.race_id+' '+e.stack?.slice(0,350));}
 }
 if(processed>=max)break;
}
const sum=rows=>Audit.summarize(rows);
const fmt=rs=>{
 const b=sum(rs.map(x=>x.baseline)),p=sum(rs.map(x=>x.proxy));
 return {n:rs.length,changed:rs.filter(x=>x.changed).length,
   baseline:{roi:b.roi,hit:b.hit_rate,first:b.first_capture,pair:b.pair_capture,net:b.net,stake:b.stake,trim1:b.trimmed?.[1],drawdown:b.max_drawdown},
   proxy:{roi:p.roi,hit:p.hit_rate,first:p.first_capture,pair:p.pair_capture,net:p.net,stake:p.stake,trim1:p.trimmed?.[1],drawdown:p.max_drawdown},
   deltas:{roi:(p.roi||0)-(b.roi||0),pair:(p.pair_capture||0)-(b.pair_capture||0),
     hit:(p.hit_rate||0)-(b.hit_rate||0),net:p.net-b.net}};
};
const groups={all:fmt(results)};
for(const dimension of ['cars','grade']){
 groups[dimension]={};
 for(const key of [...new Set(results.map(r=>r[dimension]))])
  groups[dimension][key]=fmt(results.filter(r=>r[dimension]===key));
}
const dateStats=Object.fromEntries([...new Set(results.map(r=>r.date))].map(day=>[day,fmt(results.filter(r=>r.date===day))]));
const report={schema:'tk-ex-historical-public-proxy/v1',
  training_limit:'2026-10-15',
  eval_start:minDate,eval_end:maxDate,examined:processed,unmatched,errors,
  training_races:x.splits?.train?.nRaces,holdout_reference_races:x.splits?.holdout?.nRaces,
  source_ex_valid_historical_count:0,source_ex_historical_roi:null,
  axes:usedAxes,used_riders:usedRiders,
  methodology:'Pre-2026-10-15 population/rider top-3 conditional statistics, comparison on frozen dated racecards after 2026-10-27; 8 uniform 100-yen tickets; ONLY research public-results proxies. No pre-Nov8 original WINTICKET EX source images available.',
  groups,dateStats,
  abs_profit_proven:false,official_ex_adoption_verified:false,
  code_retained_for_research:true};
console.log('EX_HISTORICAL_PROXY_REPORT '+JSON.stringify(report));
if(process.env.EX_HISTORICAL_REPORT_PATH)fs.writeFileSync(process.env.EX_HISTORICAL_REPORT_PATH,JSON.stringify(report,null,2)+'\n');
