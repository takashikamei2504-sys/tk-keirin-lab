'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Feed=require('../js/race-feed.js'),Risk=require('../js/mansha/risk.js'),Old=require('../scripts/mansha-crossline-pair-third.cjs');
require('../js/mansha/model.js');
const Cross=require('../js/crossline/selected.js'),Daily=require('../scripts/crossline-selected-daily.cjs');
const base=require('../reports/mansha/crossline-pair-third-v1.json').models;
const day='2030-05-03',start='16:30',pre=Date.parse(day+'T09:10:00+09:00'),late=Date.parse(day+'T17:40:00+09:00');
const entries=[
 [1,100,'逃','1-1','A1'],[2,98,'追','1-2','A1'],[3,98,'両','2-1','A2'],
 [4,94,'追','2-2','A2'],[5,95,'逃','3-1','A2'],[6,93,'追','3-2','A2'],[7,92,'逃','4-1','A2']
].map(([car_number,competition_score,running_style,line_position,class_rank])=>({car_number,competition_score,running_style,line_position,class_rank,rider_id:String(2000+car_number),rider_full_name:'選手'+car_number}));
const raw={venue:'福井',race_number:4,start_time:start,entries};
const feed={date:day,generated_at:day+'T09:00:00+09:00',races:[raw]};
const race=Feed.convert(raw,feed);
const card=Cross.card(race);
const old=Old.tickets(card,'regular',2,'trained2',base);
const newCandidate=Cross.pairsAndTickets(card,base);
assert.deepEqual(newCandidate.candidate4,[...old.t],'must exactly preserve historical 4-ticket ranking');
assert.deepEqual(newCandidate.pairs,old.pairs.map(p=>[p.a.no,p.b.no]),'must preserve historical ordered pairs');
assert.equal(new Set(newCandidate.candidate4).size,4);
assert.equal(Cross.validWeights(base),true);
assert.equal(Cross.validWeights({}),false);
const upper=JSON.parse(JSON.stringify(globalThis.ManshaRiskModel));
upper.thresholds.A7.q75=0;
upper.thresholds.A7.q90=1;
const result=Cross.predict(race,base,Risk,upper);
const pairReverse=result.pairs[0][0]===result.pairs[1][1]&&result.pairs[0][1]===result.pairs[1][0];
assert.equal(result.eligible,!pairReverse);
assert.equal(result.stake,result.eligible?400:0);
assert.equal(result.tickets.length,result.eligible?4:0);
const riskFiltered=JSON.parse(JSON.stringify(globalThis.ManshaRiskModel));
riskFiltered.thresholds.A7.q75=1;
riskFiltered.thresholds.A7.q90=1;
const blocked=Cross.predict(race,base,Risk,riskFiltered);
assert.equal(blocked.eligible,false);
assert.equal(blocked.stake,0);
assert.deepEqual(blocked.candidate4,newCandidate.candidate4,'skipping must not alter forecast');
const changed=Feed.convert({...raw,result_top3:[7,4,2],payout_trifecta:888888},feed);
assert.deepEqual(Cross.predict(changed,base,Risk,globalThis.ManshaRiskModel),Cross.predict(race,base,Risk,globalThis.ManshaRiskModel),'prediction never uses result/payout');
const noRank=JSON.parse(JSON.stringify(race));noRank.riders[0].meta.rank='';
assert.throws(()=>Cross.predict(noRank,base,Risk,upper));
assert.equal(Daily.freeze(race,base,{now:pre})?.forecast?.candidate4.length,4);
assert.equal(Daily.freeze(race,base,{now:Date.parse(day+'T16:30:00+09:00')}),null,'no poststart capture');
assert.equal(Daily.freeze({...race,source:{...race.source,generated_at:day+'T17:20:00+09:00'}},base,{now:pre}),null,'no poststart source');
const snap=Daily.freeze(race,base,{now:pre});
assert.ok(snap);assert.equal(snap.race_id,day+':福井:4');
const known= newCandidate.candidate4[0],parts=known.split('-').map(Number);
const actual={race_id:snap.race_id,race:{start},identity:snap.identity,source_updated_at:day+'T17:05:00+09:00',collected_at:day+'T17:25:00+09:00',
 combos:[{key:known,trio:parts,payout:10340}]};
assert.equal(Daily.gradeEval(snap,actual,late).all4.payout,10340);
assert.equal(Daily.gradeEval(snap,actual,late).selected4.stake,snap.forecast.eligible?400:0);
assert.equal(Daily.gradeEval(snap,{...actual,identity:[]},late).status,'excluded');
assert.equal(Daily.gradeEval(snap,{...actual,source_updated_at:day+'T09:00:00+09:00'},late).status,'excluded');
assert.equal(Daily.gradeEval(snap,null,late).status,'pending');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'crossline-selected-'));
(async()=>{
 try{
  const p=path.join(tmp,'data/routed_history',day);
  const d=path.join(tmp,'reports/mansha');fs.mkdirSync(p,{recursive:true});fs.mkdirSync(d,{recursive:true});
  fs.writeFileSync(path.join(d,'crossline-pair-third-v1.json'),JSON.stringify({models:base}));
  const one=Daily.capture(feed,{root:tmp,now:pre,weights:base});
  const two=Daily.capture(feed,{root:tmp,now:pre+60000,weights:base});
  assert.equal(one.new,1);assert.equal(two.existing,1);
  const saved=Daily.report(tmp,pre+60000);
  assert.equal(saved.summary.saved,1);assert.equal(saved.summary.pending,1);
  assert.equal(saved.summary.views.selected4.stake,0,'pending records excluded from ROI denominators');
  fs.writeFileSync(path.join(p,'results.json'),JSON.stringify({[snap.race_id]:actual}));
  const evaluated=Daily.report(tmp,late);
  assert.equal(evaluated.summary.eval,1);
  assert.equal(evaluated.summary.views.all4.stake,400);
  assert.equal(evaluated.summary.views.all4.payout,10340);
  assert.equal(evaluated.summary.views.selected4.stake,snap.forecast.eligible?400:0);
  assert.equal(evaluated.summary.views.selected4.payout,snap.forecast.eligible?10340:0);
  const run=await Daily.run({root:tmp,now:late,fetcher:async()=>feed});
  assert.equal(run.evaluation.summary.eval,1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp,'data/crossline_selected/evaluation.json'))).summary.eval,1);
  console.log('PASS crossline-selected: immutable original 4, gating, source safety, freeze, settlement, file output');
 }finally{fs.rmSync(tmp,{force:true,recursive:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
