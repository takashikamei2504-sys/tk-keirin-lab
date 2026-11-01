'use strict';
const assert=require('node:assert/strict'),Deliberation=require('../js/tactical-deliberation.js'),Legacy=require('../js/race-brain.js'),Context=require('../js/rider-context.js'),Brain=require('../js/story-brain.js');
const sample=structuredClone(require('../race_sample.json'));
sample.riders.find(x=>x.no===7).meta={prefecture:'山口'};
function helpers(r){const p=Legacy.profiles(r,{});return {ability:n=>Math.max(.2,Math.min(1.3,.55+(r.riders.find(x=>x.no===n).score-100)*.024)),trait:(n,k)=>p.get(n)[k]??.5};}
const model=Deliberation.build(sample,Context.build(sample),helpers(sample));
const initial={stage:2,leader:1,defender:4,order:[1,4,2,8,7,9,5,6,3],energy:Object.fromEntries(sample.riders.map(x=>[x.no,x.no===1?.13:x.no===2?.05:0])),connected:Object.fromEntries(sample.riders.map(x=>[x.no,true])),gap:'holds',outside:[]};
const choices=[{key:'settle',weight:.8},{key:'2',actor:2,weight:.25},{key:'5',actor:5,weight:.25},{key:'9',actor:9,weight:.25}];
const review=model.review(initial,'home',choices),ohta=review.rows.find(x=>x.no===2);
assert.equal(ohta.preferred,'attack');assert.ok(ohta.attack_reasons.some(x=>x.includes('3番手')));assert.ok(ohta.facts.some(x=>x.includes('地元')));
assert.ok(ohta.wait_reasons.length,'the cost of attacking and benefit of waiting must both be present');
assert.ok(ohta.counterplay.some(x=>x.no===1&&x.action==='reaccelerate'));assert.ok(ohta.counterplay.some(x=>x.no===4&&x.action==='block_or_vertical'));
assert.equal(review.assessments.get('settle').passed,false,'freezing Ohta in third must be rejected even though settle has the largest old branch weight');
assert.equal(review.assessments.get('2').passed,true);
// Waiting must remain a valid decision: a spent, inferior rider should not be made to attack for narrative variety.
const weak=structuredClone(sample);weak.riders.find(x=>x.no===2).score=92;
const weakModel=Deliberation.build(weak,Context.build(weak),helpers(weak)),tired={...initial,energy:{...initial.energy,1:.02,2:.7}};
assert.equal(weakModel.review(tired,'home',choices).rows.find(x=>x.no===2).preferred,'wait');
const patient=structuredClone(sample);patient.riders.find(x=>x.no===2).score=110;delete patient.riders.find(x=>x.no===7).meta;
const patientModel=Deliberation.build(patient,Context.build(patient),helpers(patient));
assert.equal(patientModel.review(initial,'home',choices).rows.find(x=>x.no===2).preferred,'wait');
assert.equal(patientModel.review(initial,'back',choices).rows.find(x=>x.no===2).preferred,'attack','waiting at home must not freeze the next decision');
// A blocked route is not an invitation to fabricate a move.
const blocked=choices.map(c=>c.actor?{...c,feasibility:'blocked'}:c);
assert.equal(model.review(initial,'home',blocked).assessments.get('settle').passed,true);
// A follower evaluates blocking and vertical acceleration against the current threat and front rider's remaining legs.
const defending={...initial,stage:4,cornerRider:2};
const defenses=[{key:'block'},{key:'vertical'},{key:'follow'}];
assert.equal(model.response(defending,defenses).get('block').passed,true);
assert.equal(model.response({...defending,energy:{...initial.energy,1:.9}},defenses).get('vertical').passed,true);
// An outside attacker still willing to continue cannot disappear from the main story.
const late=model.review({...initial,energy:{...initial.energy,1:.5}},'late',choices).assessments.get('2');
assert.equal(model.audit({...initial,outside:[9],cornerRider:2,decisions:[{deliberation:late}]}).passed,false);
const out=Brain.build(sample);
assert.equal(out.story.main.audit.passed,true);assert.ok(out.story.selection_review.reconsidered>0);
const checks=out.story.main.audit.reviews.filter(x=>x.phase_key);
assert.deepEqual(checks.map(x=>x.phase_key),['home','back','late']);
for(const check of checks){assert.equal(check.riders.length,9);assert.ok(check.riders.every(x=>x.wait_reasons.length>0));assert.equal(check.passed,true);}
assert.ok(out.story.selection_review.rejected_objections.some(x=>x.reason.includes('太田海也')));
const reverse=structuredClone(sample);reverse.riders.reverse();assert.equal(Brain.build(reverse).story.main.signature,out.story.main.signature);
console.log('PASS third-place challenge, justified waiting, blocker/vertical response, unresolved outside rejection and whole-story reselection before tickets');
