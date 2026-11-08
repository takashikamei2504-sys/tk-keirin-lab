'use strict';
/* Product decision experiment: independent physics ablations on original frozen
 * 2026-11-01..07 racecards. NO future EX stats used or generated.
 */
const fs=require('node:fs'),path=require('node:path');
const Brain=require('../js/race-brain.js'),History=require('./history-store.cjs');
const Audit=require('../js/roi/audit.cjs'),Shadow=require('../js/ex-roi/shadow.cjs');
const dataDir=path.join(__dirname,'../data/lab_history');
const modes=['legacy','physical_follow_only','physical_seat_only','physical_v2'];
const cap=Math.min(500,Math.max(1,Number(process.argv[2]||500)));
const rows=[],errors=[],days=History.dates(dataDir).filter(x=>x>='2026-11-01'&&x<='2026-11-07');
for(const day of days){
 const hist=History.load(dataDir,day),results=new Map(hist.results.map(x=>[x.race_id,x]));
 const latest=new Map();
 for(const p of hist.predictions){if(!Audit.validForecast(p))continue;
  const old=latest.get(p.race_id);if(!old||Date.parse(p.saved_at)>Date.parse(old.saved_at))latest.set(p.race_id,p);}
 for(const p of [...latest.values()].sort((a,b)=>a.race_id.localeCompare(b.race_id))){
  if(rows.length>=cap)break;
  const result=results.get(p.race_id);if(!result)continue;
  try{
   const outcomes={};
   for(const mode of modes){
    const built=Brain.build(p.input,{transitionMode:mode,exAsOf:Date.parse(p.saved_at)});
    const tickets=Shadow.select(built);
    if(tickets.length!==8)throw Error('TICKET_CARDINALITY_'+mode);
    const report=Audit.settle({...p,chosen:tickets},result);
    if(report.status!=='evaluated')throw Error('SETTLEMENT_'+mode+':'+report.status);
    const taken=built.narratives.filter(n=>n.mode==='seat').length;
    if(mode==='physical_v2'&&built.narratives.some(n=>n.mode==='seat'&&n.seat_state!=='attempted_takeover'))throw Error('UNSAFE_SEAT');
    outcomes[mode]={report,tickets,seatPaths:taken};
   }
   rows.push({race:p.race_id,date:day,cars:p.identity.length,grade:outcomes.legacy.report.grade,outcomes});
  }catch(e){errors.push({race:p.race_id,error:e.message});if(errors.length<5)console.error('ABLAT_ERROR '+p.race_id+' '+e.message);}
 }
 if(rows.length>=cap)break;
}
const summarize=group=>Object.fromEntries(modes.map(mode=>{
 const evals=group.map(r=>r.outcomes[mode].report);
 const summary=Audit.summarize(evals);
 const changed=group.filter(r=>Shadow.diff(r.outcomes.legacy.tickets,r.outcomes[mode].tickets).same===false).length;
 const pairChanged=group.filter(r=>Shadow.diff(r.outcomes.legacy.tickets,r.outcomes[mode].tickets).pair_added.length>0||
 Shadow.diff(r.outcomes.legacy.tickets,r.outcomes[mode].tickets).pair_dropped.length>0).length;
 const seatPaths=group.reduce((a,r)=>a+r.outcomes[mode].seatPaths,0);
 return [mode,{n:group.length,roi:summary.roi,net:summary.net,hit:summary.hit_rate,
  pair:summary.pair_capture,first:summary.first_capture,trimmed1:summary.trimmed?.[1],
  dd:summary.max_drawdown,changed,pairChanged,seatPaths}];
}));
const overall=summarize(rows);
const out={schema:'tk-ex-physical-mode-ablation/v1',source:'frozen 2026-11-01..07 public pre-race entries; NO WINTICKET EX historical backfill',
 date_start:days[0],date_end:days.at(-1),evaluated:rows.length,errors:errors.slice(0,10),
 equal_stake_per_race:800,overall,
 cars:Object.fromEntries([...new Set(rows.map(r=>r.cars))].sort().map(c=>[c,summarize(rows.filter(r=>r.cars===c))])),
 grades:Object.fromEntries([...new Set(rows.map(r=>r.grade))].map(c=>[c,summarize(rows.filter(r=>r.grade===c))])),
 adoption_policy:'Do not change actual ticket purchasing on training results; require EX at-race observation and future paired ROI.',
};
if(process.env.EX_PHYSICAL_ABLATION_PATH){const target=process.env.EX_PHYSICAL_ABLATION_PATH;fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(out,null,2)+'\n');}
console.log('EX_PHYSICAL_MODE_ABLATION '+JSON.stringify(out));
