'use strict';
const assert=require('node:assert/strict');
const {parseRace,featureStats,FEATURES}=require('../scripts/mansha-study.cjs');
const x={
  venue:'架空',race_number:1,grade:'F1',round_name:'予選',payout_trifecta:10420,
  result_top3:[3,2,1],
  entries:[
    {car_number:1,class_rank:'A1',competition_score:90,running_style:'逃',line_position:'1-1'},
    {car_number:2,class_rank:'A1',competition_score:89,running_style:'追',line_position:'1-2'},
    {car_number:3,class_rank:'A2',competition_score:87,running_style:'両',line_position:'2-1'},
    {car_number:4,class_rank:'A2',competition_score:86,running_style:'逃',line_position:'3-1'},
    {car_number:5,class_rank:'A2',competition_score:85,running_style:'追',line_position:'3-2'},
    {car_number:6,class_rank:'A2',competition_score:84,running_style:'逃',line_position:'4-1'},
    {car_number:7,class_rank:'A2',competition_score:83,running_style:'追',line_position:'4-2'},
  ]
};
const skipped=()=>({size:0,girls_or_unclassified:0,pending_or_invalid_result:0,multiple_results:0,invalid_prelude:0});
const row=parseRace(x,'2026-06-22',skipped());
assert.equal(row.cat,'A7');assert.equal(row.high,1);
assert.equal(row.leaderCount,3);assert.equal(row.leaderLines,3);
assert.equal(row.top2Diff,0);assert.equal(row.lineCount,4);
assert.equal(row.winnerCross,1);assert.equal(row.winnerTop,0);
const f=FEATURES.find(t=>t[0]==='escape3');assert.equal(f[2](row),true);
const low=parseRace({...x,payout_trifecta:8500,result_top3:[1,2,3]},'2026-06-22',skipped());
assert.equal(low.high,0);assert.equal(low.mid,1);
const summary=featureStats([row,low],r=>r.leaderCount>=3);
assert.equal(summary.n,2);assert.equal(summary.high,1);assert.equal(summary.rate,0.5);
const woman={...x,entries:x.entries.map(e=>({...e,class_rank:null}))};
const s=skipped();assert.equal(parseRace(woman,'2026-06-22',s),null);assert.equal(s.girls_or_unclassified,1);
const duplicate={...x,result_top3:[1,1,3]},s2=skipped();assert.equal(parseRace(duplicate,'2026-06-22',s2),null);assert.equal(s2.pending_or_invalid_result,1);
const tie={...x,result_combos:[{payout:10000},{payout:12000}]},s3=skipped();assert.equal(parseRace(tie,'2026-06-22',s3),null);assert.equal(s3.multiple_results,1);
const miss={...x,entries:x.entries.map(e=>({...e,line_position:null}))},s4=skipped();assert.equal(parseRace(miss,'2026-06-22',s4),null);assert.equal(s4.invalid_prelude,1);
console.log('mansha-study: tests passed');
