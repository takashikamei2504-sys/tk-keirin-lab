'use strict';
/* Model plausibility gates, not proof of physical possibility or adjudication. */
const assert=require('node:assert/strict');
const Reality=require('../js/race-reality.js');
const Brain=require('../js/story-brain.js');
const sample=require('../race_sample.json');
const ids=sample.riders.map(x=>x.no);
const energy=Object.fromEntries(ids.map(n=>[n,.1]));
const base={order:[1,4,2,8,7,9,5,6,3],energy,leader:1,outside:[],survivingAttack:null,innerRider:null};
assert.equal(Reality.validOrder(base.order,ids),true);
assert.equal(Reality.validOrder([1,1,...base.order.slice(2)],ids),false);
// Rider can try from the rear, but cannot instantly claim first at the back
// without any recorded earlier move. Continuing on the outside is different.
const fromSixth={...base,backRider:9};
assert.equal(Reality.takeoverOpportunity(fromSixth,9,'back').allowed,false);
assert.equal(Reality.takeoverOpportunity({...fromSixth,outside:[9]},9,'back').allowed,true);
assert.equal(Reality.takeoverOpportunity({...base,attacker:9,outcome:'front-holds'},9,'home').allowed,true);
assert.equal(Reality.takeoverOpportunity(base,9,'home').allowed,false);
// Home winner dispossessed at the back should not perform a third full sprint
// without a modeled recovery step.
const thrice={...base,homeRider:1,homeResult:'takes',backRider:2,backResult:'takes'};
assert.equal(Reality.attackOpportunity(thrice,1,'late').allowed,false);
assert.equal(Reality.audit({...thrice,cornerRider:1},ids).passed,false);
// A successful block cannot make the blocked attacker advance.
const blocked={...base,cornerRider:2,cornerOrderBefore:[...base.order],blockResult:'stopped'};
assert.equal(Reality.audit({...blocked,order:[1,2,4,8,7,9,5,6,3]},ids).issues.some(e=>e.code==='blocked_advance'),true);
assert.equal(Reality.audit(blocked,ids).passed,true);
// 7th rider cannot be promoted to the winner by last-straight score alone.
assert.equal(Reality.finishingAccess(base,5,1).allowed,false);
assert.equal(Reality.finishingAccess(base,2,2).allowed,true);
assert.equal(Reality.finishingAccess({...base,survivingAttack:5},5,3).allowed,false);
assert.ok(Reality.finishExplanation(base,[1,4,2],n=>n+'番').includes('最終コーナー'));
// A concrete race-day case from the published Nov 2, 2026, pre-race entry
// feed, used only as a fixture; no outcome data enters the model.
const real={
 date:'2026-11-02',venue:'防府',race_no:12,grade:'GIII',class:'S級準決勝',start:'16:19',
 lineup:[[1,5,7],[2,8],[6,3],[4,9]],
 riders:[
  [1,'太田海也',123.50,'逃'],[2,'長島大介',109.14,'両'],
  [3,'村上博幸',112.55,'追'],[4,'阿部英斗',105.33,'逃'],
  [5,'清水裕友',116.07,'両'],[6,'栗山和樹',103.25,'逃'],
  [7,'小倉竜二',109.00,'追'],[8,'竹内智彦',104.52,'追'],
  [9,'原井博斗',108.40,'追']
 ].map(([no,name,score,style])=>({no,name,score,style,meta:{absent_fields:['s','b','wins','seconds','thirds','outs']}})),
 source:{label:'pre-race public entry feed'}
};
for(const race of [sample,real]){
 const prediction=Brain.build(race);
 assert.equal(prediction.diagnostics.realityVersion,Reality.VERSION);
 assert.ok(Math.abs(prediction.diagnostics.terminalMass+prediction.diagnostics.unresolvedMass-1)<1e-9);
 assert.equal(prediction.chosen.length,10);
 for(const story of [prediction.story.main,...prediction.story.alternatives]){
  assert.equal(story.scenes.length,6);
  assert.ok(story.scenes[5].action.includes('最終コーナー'));
  assert.deepEqual([...story.scenes[3].order].sort((a,b)=>a-b),race.riders.map(x=>x.no).sort((a,b)=>a-b));
 }
}
console.log('PASS race reality gates + 2026-11-02 防府12R pre-race fixture');
