'use strict';
const assert=require('node:assert/strict');
const B=require('../js/b-axis/engine.js');
const Input=require('../js/line/input.js');
const s9=Input.prepare(require('../race_sample.json'),{},Date.parse('2026-10-31T04:00:00.000Z'));
const raw7=require('../reports/line/example-7.json');
const s7=Input.prepare(raw7.input.race,{intelligence:raw7.input.replay_pack},Date.parse(raw7.input.as_of));
for(const input of [s7,s9]){
 for(const rider of input.race.riders){
  for(const tactic of B.tacticsFor(input,rider.no)){
   const o=B.build(input,{bNo:rider.no,tactic,limit:10});
   const data=o.b.interactions;
   assert.equal(data.selectedB,rider.no);
   assert.equal(data.estimatedPopulationBlockSuccessRate,null,'never invent a numeric block rate');
   assert.equal(data.measuredBlockAttempts,0,'modeled contests are not observations');
   assert.deepEqual(data.attackers.map(x=>x.no),[...new Set(data.attackers.map(x=>x.no))]);
   assert(data.attackers.every(x=>!x.blockable||data.defender?.connected));
   assert(data.attackers.every(x=>!x.followed||x.followerNo!==null));
   assert(data.detachment.every(x=>!data.attackers.some(a=>a.no===x.no)));
   const first3=o.tickets.slice(0,3).map(t=>t.key),first10=o.tickets.map(t=>t.key);
   assert.deepEqual(first3,first10.slice(0,3));
   assert(o.tickets.length<=10);
  }
 }
}
let tested=0;
for(const r of s9.race.riders){
 const mode=B.tacticsFor(s9,r.no)[0],snap=B.snapshot(s9,r.no,mode);
 const interaction=B.Interactions.review(s9,snap);
 const mark=snap.states.find(s=>s.role==='B番手');
 if(!mark||!interaction.defender?.connected)continue;
 const altered=structuredClone(snap);
 altered.states.find(s=>s.no===mark.no).track='追走離れ気味';
 const detached=B.Interactions.review(s9,altered);
 assert.equal(detached.defender?.connected,false);
 assert(detached.attackers.every(a=>a.blockable===false));
 tested++;
 break;
}
assert(tested>0,'fixture must exercise an attached marker that can become detached');
const official=require('../scripts/b_axis_mechanism_audit.cjs');
assert.equal(official.counts.explicitBlocks,4);
assert.equal(official.counts.confirmedDetachment,2);
assert.equal(official.counts.followed,1);
console.log('B-AXIS interaction tests passed: 7/9 rider scenario grid, attached marker, no fictitious block/detachment rates');
