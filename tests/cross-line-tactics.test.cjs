'use strict';
const assert=require('node:assert/strict');
const Cross=require('../js/cross-line-tactics.js');
const Legacy=require('../js/race-brain.js');
const Context=require('../js/rider-context.js');
const Brain=require('../js/story-brain.js');
const sample=structuredClone(require('../race_sample.json'));
const opts=r=>{const p=Legacy.profiles(r,{});return {ability:n=>Math.min(1.3,Math.max(.2,.55+(r.riders.find(x=>x.no===n).score-100)*.024)),trait:(n,k)=>p.get(n)[k]??.5};};
function setup(r){
 const s={front:1,leader:1,stage:1,order:[1,5,7,2,8,4,9,6,3],energy:Object.fromEntries(r.riders.map(x=>[x.no,0]))};
 const options=[
  {key:'2:press',actor:2,feasibility:'allowed'},
  {key:'2:kamashi',actor:2,feasibility:'allowed'},
  {key:'4:press',actor:4,feasibility:'allowed'},
  {key:'4:kamashi',actor:4,feasibility:'allowed'},
  {key:'6:press',actor:6,feasibility:'allowed'},
  {key:'6:kamashi',actor:6,feasibility:'allowed'},
  {key:'wait',actor:null,feasibility:'allowed'}
 ];
 return {s,options};
}
// Fictional statistical fixture: a position-taking rider has 0/22 B,
// while two other self-starting lines have higher B rates.
// No historical race outcome or actual comment is supplied here.
const race={
 date:'2026-11-02',venue:'防府',race_no:12,start:'16:19',
 lineup:[[1,5,7],[2,8],[6,3],[4,9]],
 riders:[
 [1,'太田海也',123.5,'逃',2,4],
 [2,'長島大介',109.14,'両',0,22],
 [3,'村上博幸',112.55,'追',0,20],
 [4,'阿部英斗',105.33,'逃',9,20],
 [5,'清水裕友',116.07,'両',0,20],
 [6,'栗山和樹',103.25,'逃',8,18],
 [7,'小倉竜二',109,'追',0,20],
 [8,'竹内智彦',104.52,'追',0,20],
 [9,'原井博斗',108.4,'追',0,20]
 ].map(([no,name,score,style,b,total])=>({no,name,score,style,recent_form:{stats:{b,total,top3_rate:30}}})),
 source:{label:'test fixture'}
};
const {s,options}=setup(race);
const cross=Cross.build(race,Context.build(race),opts(race));
const review=cross.review(s,options);
assert.equal(review.profiles.length,4);
assert.ok(review.assessments.get('2:kamashi').regret>review.assessments.get('2:press').regret,
 'B0 rider should prefer a measured press over an unsupported early full-speed kamashi');
assert.equal(review.assessments.get('2:kamashi').comparisons.length,7);
assert.ok(review.assessments.get('2:kamashi').opponents.some(x=>x.no===4));
assert.ok(review.assessments.get('2:kamashi').opponents.some(x=>x.no===6));
assert.ok(review.assessments.get('2:kamashi').comparisons.find(x=>x.key==='2:kamashi').opponent.includes('太田海也'));
assert.ok(review.assessments.get('2:kamashi').rejected.length>=2);
const unknown=structuredClone(race);
delete unknown.riders.find(x=>x.no===2).recent_form;
const alt=Cross.build(unknown,Context.build(unknown),opts(unknown)).review(s,options);
assert.ok(alt.assessments.get('2:kamashi').regret<review.assessments.get('2:kamashi').regret,
 'missing B data must not be silently treated as B0');
const reordered=structuredClone(race);reordered.riders.reverse();
const again=Cross.build(reordered,Context.build(reordered),opts(reordered)).review(s,options);
assert.deepEqual(again.assessments.get('2:kamashi').comparisons,review.assessments.get('2:kamashi').comparisons);
const blocked=options.map(x=>x.actor===4?{...x,feasibility:'blocked'}:x);
assert.ok(!Cross.build(race,Context.build(race),opts(race)).review(s,blocked).assessments.get('wait').rejected.some(x=>x.actor===4));
// Entire forecast still selects one coherent storyline before the tickets.
const out=Brain.build(sample);
const decision=out.story.main.decisions.find(x=>x.key==='red-attack');
assert.ok(decision?.strategic&&decision.strategic.comparisons.length>=3);
assert.equal(out.story.main.scenes.length,6);
assert.ok(out.chosen.length>=1&&out.chosen.length<=10);
console.log('PASS pre-bell opponent counterplay, B0 vs missing, alternative reactions, determinism and story integration');
