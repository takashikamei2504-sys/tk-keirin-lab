'use strict';
const assert=require('node:assert/strict');
const {parseRace}=require('../scripts/mansha-study.cjs');
const risk=require('../js/mansha/risk.js');
const {auc}=require('../scripts/mansha-risk-audit.cjs');
function stats(){return {size:0,girls_or_unclassified:0,pending_or_invalid_result:0,multiple_results:0,invalid_prelude:0}}
const entries=[
 {car_number:1,class_rank:'A1',competition_score:90,running_style:'逃',line_position:'1-1'},
 {car_number:2,class_rank:'A1',competition_score:89,running_style:'追',line_position:'1-2'},
 {car_number:3,class_rank:'A2',competition_score:87,running_style:'両',line_position:'2-1'},
 {car_number:4,class_rank:'A2',competition_score:86,running_style:'逃',line_position:'3-1'},
 {car_number:5,class_rank:'A2',competition_score:85,running_style:'追',line_position:'3-2'},
 {car_number:6,class_rank:'A2',competition_score:84,running_style:'逃',line_position:'4-1'},
 {car_number:7,class_rank:'A2',competition_score:83,running_style:'追',line_position:'4-2'},
];
const race={venue:'fixture',race_number:1,grade:'F1',round_name:'予選',payout_trifecta:13450,result_top3:[3,2,1],entries};
const original=parseRace(race,'2026-06-22',stats());
const card={riders:entries.map(e=>({
 no:e.car_number,score:e.competition_score,style:e.running_style,meta:{rank:e.class_rank}
})),lineup:[[1,2],[3],[4,5],[6,7]]};
const pre=risk.featuresFromRace(card);
for(const f of ['cat','lineCount','leaderCount','range','gap','top2Diff','solo','lineGap','top1Escape'])assert.equal(pre[f],original[f]);
const fake=Array.from({length:100},(_,i)=>({...pre,high:Number(i%3===0),cat:i%5===0?'C7':'A7',range:i%3===0?6:14,gap:i%3===0?1:8}));
const mod=risk.fit(fake);risk.calibrate(mod,fake);risk.thresholdFromValidation(mod,fake);
assert(Number.isFinite(risk.probability(pre,mod)));
assert(risk.score(pre,mod).percent>=0&&risk.score(pre,mod).percent<=100);
assert.deepEqual(risk.FEATURE_NAMES,mod.features);
assert.throws(()=>risk.columns({cat:'A7'}),/Missing/);
assert.throws(()=>risk.featuresFromRace({...card,riders:[...card.riders,{...card.riders[0]}]}),/Invalid/);
assert.equal(auc([{high:0},{high:1}],r=>r.high),1);
assert.equal(auc([{high:1},{high:0}],r=>1-r.high),0);
assert.equal(auc([{high:1},{high:0}],()=>0.5),0.5);
// Outcome must have no effect on pre-race risk.
const raceOutcome2={...race,result_top3:[7,4,2],payout_trifecta:520};
const sameCard={...card};
const second=parseRace(raceOutcome2,'2026-06-22',stats());
assert.equal(original.range,second.range);
assert.equal(risk.probability(risk.featuresFromRace(sameCard),mod),risk.probability(pre,mod));
console.log('PASS mansha-risk training, pre-race feature parity and no outcome leakage');