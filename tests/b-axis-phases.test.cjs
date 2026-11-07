'use strict';
const assert=require('node:assert/strict');
const B=require('../js/b-axis/engine.js');
const LineInput=require('../js/line/input.js');
const sample9=LineInput.prepare(require('../race_sample.json'),{},Date.parse('2026-10-31T04:00:00.000Z'));
const example7=require('../reports/line/example-7.json');
const sample7=LineInput.prepare(example7.input.race,{intelligence:example7.input.replay_pack},Date.parse(example7.input.as_of));
function assertPhases(out){
 const phases=out.b.phases,ids=out.race.riders.map(r=>r.no).sort((a,b)=>a-b);
 assert.deepEqual(phases.map(p=>p.id),['initial','red_bell','home','back','corner','finish']);
 assert.equal(phases[3].leader,out.b.bNo);
 assert.equal(phases[3].order[0],out.b.bNo);
 assert.equal(phases[3].positions.find(p=>p.no===out.b.bNo).gap,0);
 assert.equal(out.b.audit.passed,true);
 const prior=new Map();
 for(const s of phases){
  assert.deepEqual(s.order.slice().sort((a,b)=>a-b),ids,'no disappearing/duplicated riders');
  assert.deepEqual(s.positions.map(p=>p.no).sort((a,b)=>a-b),ids);
  assert.ok(s.events.length,'explain tactical action at every phase');
  for(const event of s.events)assert.ok(event.reason&&typeof event.reason==='string');
  for(const p of s.positions){
   assert(Number.isFinite(p.spent)&&p.spent>=0&&p.spent<=1);
   assert(Number.isFinite(p.gap)&&p.gap>=0);
   if(prior.has(p.no))assert(p.spent+.001>=prior.get(p.no),'no stamina reset');
   prior.set(p.no,p.spent);
  }
 }
 assert.deepEqual(out.b.states.map(x=>x.no).sort((a,b)=>a-b),ids);
 if(out.tickets.length){
  assert.deepEqual(phases[5].order.slice(0,3),out.tickets[0].trio,'front 3 reflect chosen trio');
  assert.equal(phases[5].leader,out.tickets[0].trio[0]);
 }
 for(const p of phases.slice(0,4)){
  assert.deepEqual(p.lineOrder.flat().slice().sort((a,b)=>a-b),ids);
 }
}
for(const sample of [sample7,sample9]){
 for(const r of sample.race.riders){
  const out=B.build(sample,{bNo:r.no,limit:10});
  assertPhases(out);
  for(const tactic of B.tacticsFor(sample,r.no)){
   const x=B.build(sample,{bNo:r.no,tactic,limit:3});
   assertPhases(x);
   assert.equal(x.b.tactic,tactic);
   assert.ok(x.tickets.length<=3);
  }
 }
}
const lead=sample9.race.lineup[0][0],follower=sample9.race.lineup[0][1];
const a=B.build(sample9,{bNo:lead,tactic:'press'});
const b=B.build(sample9,{bNo:lead,tactic:'kamashi'});
assert.notDeepEqual(a.b.phases[1].lineOrder,b.b.phases[1].lineOrder,'tactics must change red-bell formation');
assert.notDeepEqual(a.b.phases[2].events,b.b.phases[2].events,'tactics must change home actions');
assert.notEqual(a.b.leadingCost,b.b.leadingCost,'tactics must change effort');
const follow=B.build(sample9,{bNo:follower,tactic:'surge'});
assert.equal(follow.b.phases[2].leader,lead,'original front drives before rear rider takes final B');
assert.equal(follow.b.phases[3].leader,follower);
assert.ok(follow.b.phases[3].events.some(x=>x.action==='reorder'));
const tamper=structuredClone(a.b);
tamper.phases[3].positions.find(p=>p.no===lead).spent=0;
assert.equal(B.Phases.audit(tamper).passed,false,'detect effort history reversal');
const invalid=structuredClone(a.b);
invalid.phases[3].positions[1].no=invalid.phases[3].positions[0].no;
assert.equal(B.Phases.audit(invalid).passed,false,'detect duplicated rider');
console.log('B-AXIS six-phase tests passed: all riders and allowed B tactics, 7/9 riders, stamina audit and finish consistency');
