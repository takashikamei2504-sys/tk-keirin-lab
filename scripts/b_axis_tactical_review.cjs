'use strict';
const fs=require('node:fs');
const path=require('node:path');
const LineInput=require('../js/line/input.js');
const B=require('../js/b-axis/engine.js');
const hist=JSON.parse(fs.readFileSync(path.join(__dirname,'..','data/lab_history/2026-11-01.json'),'utf8'));
const tests=[
 '2026-11-01:久留米:10',
 '2026-11-01:宇都宮:4',
 '2026-11-01:松戸:6',
 '2026-11-01:西武園:4',
 '2026-11-01:宇都宮:8',
 '2026-11-01:久留米:6'
];
function check(raw,asOf,label,result){
 try{
  const i=LineInput.prepare(raw,{},Date.parse(asOf));const o=B.build(i,{limit:10});
  function strip(x){return {b:x.b.bNo,tactic:x.b.tactic,leadingCost:x.b.leadingCost,states:x.b.states.map(s=>({no:s.no,role:s.role,atB:s.atB,gap:s.gap,remaining:s.remaining,closing:s.closing})),tickets:x.tickets.map(t=>({key:t.key,score:t.score,nonB:t.trio[0]!==x.b.bNo,reason:t.reason}))};}
  const alternatives=i.race.lineup.map(l=>l[0]).filter(n=>n!==o.b.bNo).slice(0,2).map(n=>strip(B.build(i,{bNo:n,limit:10})));
  const printed={label,race_class:raw.class,lineup:raw.lineup,pre_as_of:asOf,rawB:raw.riders.map(x=>[x.no,x.name,x.b,x.style,x.score]),aiB:o.bCandidates.map(c=>({no:c.no,support:c.support,basis:c.basis})),main:strip(o),alternatives,actual:result};
  console.log('B_AXIS_REVIEW '+JSON.stringify(printed));
 }catch(e){console.log('B_AXIS_REVIEW_ERROR '+JSON.stringify({label,message:e.stack||String(e)}));}
}
for(const id of tests){
 const p=hist.predictions.find(p=>p.race_id===id);
 const actual=hist.results.find(p=>p.race_id===id)?.combos?.[0]?.key||null;
 if(p)check(p.input,p.saved_at,id,actual);
}
const s=JSON.parse(fs.readFileSync(path.join(__dirname,'..','race_sample.json'),'utf8'));
check(s,'2026-10-31T04:00:00.000Z','2026-10-31:防府:12 SAMPLE',null);
console.log('B_AXIS_REVIEW_DONE');
