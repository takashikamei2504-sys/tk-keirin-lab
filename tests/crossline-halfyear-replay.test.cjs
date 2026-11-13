'use strict';
const assert=require('node:assert/strict');
const replay=require('../scripts/crossline-halfyear-replay.cjs'),study=require('../scripts/mansha-crossline-pair-third.cjs');
const raw={venue:'合成',race_number:1,grade:'F2',round_name:'予選',entries:[
{car_number:1,class_rank:'A1',competition_score:94,running_style:'逃',line_position:'1-1'},
{car_number:2,class_rank:'A1',competition_score:91,running_style:'追',line_position:'1-2'},
{car_number:3,class_rank:'A2',competition_score:90,running_style:'両',line_position:'2-1'},
{car_number:4,class_rank:'A2',competition_score:87,running_style:'追',line_position:'2-2'},
{car_number:5,class_rank:'A2',competition_score:86,running_style:'逃',line_position:'3-1'},
{car_number:6,class_rank:'A2',competition_score:83,running_style:'追',line_position:'3-2'},
{car_number:7,class_rank:'A2',competition_score:80,running_style:'逃',line_position:'4-1'}],
result_top3:[3,2,5],payout_trifecta:38240};
const excluded=()=>({size:0,girls_or_unclassified:0,pending_or_invalid_result:0,multiple_results:0,invalid_prelude:0});
const w={regular:{winner:{weights:[.60,.21,.12,.36,-.49,-.03,.44,.38,-.58,0,0,0]},second:{weights:[.31,.18,-.02,.33,-.3,-.17,.44,.24,-.1,0,0,0]}},third:{weights:[.18,-.05,.04,.04,-.08,.05,-.085,-.065,-.19,.19,.06,-.26]}};
const card=study.createCard(raw,'2026-10-18',excluded());
assert.ok(card);
const p=replay.predict(card,w);
assert.equal(p.baseline8.length,8);assert.equal(p.hybrid8.length,8);assert.equal(p.cross4.length,4);assert.equal(p.cross2full.length,10);assert.equal(p.cross1full.length,5);
assert.equal(new Set(p.baseline8).size,8);assert.equal(new Set(p.hybrid8).size,8);
assert.deepEqual(p.hybrid8.slice(0,6),p.baseline8.slice(0,6));
assert.deepEqual(p,replay.predict(card,w),'deterministic');
for(const key of p.cross4){const [a,b]=key.split('-').map(Number);assert.notEqual(card.byNo.get(a).line,card.byNo.get(b).line);}
const changed=study.createCard({...raw,result_top3:[4,7,2],payout_trifecta:240},'2026-10-18',excluded());
assert.deepEqual(replay.predict(card,w),replay.predict(changed,w),'predictions must not access observed result or payout');
const row=replay.score(card,w),s=replay.summary([row]);
assert.equal(s.races,1);assert.equal(s.baseline8.stake,800);assert.equal(s.hybrid8.stake,800);assert.equal(s.cross4.stake,400);
assert.equal(s.cross2full.stake,1000);
const half=replay.evaluate([card,changed],w);
assert.equal(half.result.overall.races,2);
assert.equal(half.rows[0].date,'2026-10-18');
console.log('PASS cross-line halfyear replay: no outcome leakage; fixed budgets; deterministic');
