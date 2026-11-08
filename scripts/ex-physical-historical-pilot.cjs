'use strict';
/* Frozen historical pre-race racecards; NO retrospective WINTICKET EX data.
 * This diagnoses physical-transition structure before EX outcome evidence exists.
 */
const fs=require('node:fs'),path=require('node:path');
const Brain=require('../js/race-brain.js');
const History=require('./history-store.cjs');
const Audit=require('../js/roi/audit.cjs');
const Shadow=require('../js/ex-roi/shadow.cjs');
const root=path.join(__dirname,'..'),dir=path.join(root,'data/lab_history');
const dates=History.dates(dir).filter(d=>d>='2026-11-01'&&d<='2026-11-07');
const cap=Math.min(500,Math.max(1,Number(process.argv[2]||500)));
const data=[],all={races:0,eligible:0,missing_result:0,invalid:0,failures:0,
    legacy_seat_hypotheses:0,v2_seat_hypotheses:0,v2_vacant_hypotheses:0,physical_gap_checks:0};
for(const day of dates){
 const hist=History.load(dir,day),results=new Map(hist.results.map(r=>[r.race_id,r]));
 const latest=new Map();
 for(const p of hist.predictions){
  if(!Audit.validForecast(p))continue;
  const prior=latest.get(p.race_id);
  if(!prior||Date.parse(p.saved_at)>Date.parse(prior.saved_at))latest.set(p.race_id,p);
 }
 for(const p of [...latest.values()].sort((a,b)=>a.race_id.localeCompare(b.race_id))){
  if(data.length>=cap)break;all.races++;
  const result=results.get(p.race_id);
  if(!result){all.missing_result++;continue;}
  try{
   const legacy=Brain.build(p.input,{transitionMode:'legacy',exAsOf:Date.parse(p.saved_at)});
   const physical=Brain.build(p.input,{transitionMode:'physical_v2',exAsOf:Date.parse(p.saved_at)});
   const picksA=Shadow.select(legacy),picksB=Shadow.select(physical);
   if(picksA.length!==8||picksB.length!==8){all.invalid++;continue;}
   const a=Audit.settle({...p,chosen:picksA},result),b=Audit.settle({...p,chosen:picksB},result);
   if(a.status!=='evaluated'||b.status!=='evaluated'){all.invalid++;continue;}
   const oldSeats=legacy.narratives.filter(n=>n.mode==='seat').length;
   const newSeats=physical.narratives.filter(n=>n.mode==='seat').length;
   const newVacants=physical.narratives.filter(n=>n.gap==='breaks'&&!n.seat).length;
   const checks=physical.narratives.filter(n=>n.gap==='breaks').length;
   if(physical.narratives.some(n=>n.mode==='seat'&&n.seat_state!=='attempted_takeover')||
     physical.narratives.some(n=>n.gap==='breaks'&&n.snapshots?.[2]?.wheel_links?.[0]?.status!=='breaks'))throw Error('PHYSICAL_INVARIANT_BROKEN');
   all.legacy_seat_hypotheses+=oldSeats;all.v2_seat_hypotheses+=newSeats;all.v2_vacant_hypotheses+=newVacants;all.physical_gap_checks+=checks;
   const same=Shadow.diff(picksA,picksB).same;
   data.push({day,race:p.race_id,cars:p.identity.length,grade:a.grade,
    pair_changed:!Shadow.diff(picksA,picksB).pair_added.length&&!Shadow.diff(picksA,picksB).pair_dropped.length?false:true,
    changed:!same,old_seats:oldSeats,new_seats:newSeats,baseline:a,candidate:b,
    net_delta:b.wins.reduce((s,x)=>s+x,0)-a.wins.reduce((s,x)=>s+x,0)});
   all.eligible++;
  }catch(e){all.failures++;if(all.failures<5)console.error('EX_PHYSICAL_HISTORICAL_ERROR '+p.race_id+' '+e.message);}
 }
 if(data.length>=cap)break;
}
const summarize=rows=>{
 const a=Audit.summarize(rows.map(x=>x.baseline)),b=Audit.summarize(rows.map(x=>x.candidate));
 return {n:rows.length,changed:rows.filter(x=>x.changed).length,pair_changed:rows.filter(x=>x.pair_changed).length,
  baseline:{roi:a.roi,pair:a.pair_capture,first:a.first_capture,hit:a.hit_rate,stake:a.stake,net:a.net,dd:a.max_drawdown},
  physical:{roi:b.roi,pair:b.pair_capture,first:b.first_capture,hit:b.hit_rate,stake:b.stake,net:b.net,dd:b.max_drawdown},
  delta:{roi:(b.roi||0)-(a.roi||0),pair:(b.pair_capture||0)-(a.pair_capture||0),
   net:b.net-a.net},
  outlier_adjusted:{baseline:a.trimmed?.[1],physical:b.trimmed?.[1]}};
};
const report={schema:'tk-ex-physical-historical-pilot/v1',scope:'Public pre-race racecard only; NO original EX observation before 2026-11-08',
 dates,all,overall:summarize(data),byCars:Object.fromEntries([...new Set(data.map(x=>x.cars))].map(k=>[k,summarize(data.filter(x=>x.cars===k))])),
 byGrade:Object.fromEntries([...new Set(data.map(x=>x.grade))].map(k=>[k,summarize(data.filter(x=>x.grade===k))])),
 changedByDay:Object.fromEntries([...new Set(data.map(x=>x.day))].map(k=>[k,data.filter(x=>x.day===k).filter(x=>x.changed).length])),
 policy:'Research diagnostic; not an EX-specific effectiveness claim. No retroactive use of November 8 EX counts.'};
const file=process.env.EX_PHYSICAL_REPORT_PATH;
if(file){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');}
console.log('EX_PHYSICAL_HISTORICAL_PILOT '+JSON.stringify(report));
