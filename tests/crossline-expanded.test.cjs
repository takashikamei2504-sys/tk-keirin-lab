'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const Feed=require('../js/race-feed.js'),Risk=require('../js/mansha/risk.js');
require('../js/mansha/model.js');
const Cross=require('../js/crossline/selected.js'),Expanded=require('../js/crossline/expanded.js');
const Old=require('../scripts/crossline-selected-daily.cjs'),Shadow=require('../scripts/crossline-expanded-forward.cjs');
const weights=require('../reports/mansha/crossline-pair-third-v1.json').models;
const date='2030-05-03',start='16:30',now=Date.parse(date+'T09:10:00+09:00'),late=Date.parse(date+'T17:40:00+09:00');
const entries=[
 [1,100,'逃','1-1','A1'],[2,98,'追','1-2','A1'],[3,98,'両','2-1','A2'],
 [4,94,'追','2-2','A2'],[5,95,'逃','3-1','A2'],[6,93,'追','3-2','A2'],[7,92,'逃','4-1','A2']
].map(([car_number,competition_score,running_style,line_position,class_rank])=>({
 car_number,competition_score,running_style,line_position,class_rank,
 rider_id:String(2000+car_number),rider_full_name:'選手'+car_number
}));
const raw={venue:'福井',race_number:4,start_time:start,entries},
 feed={date,generated_at:date+'T09:00:00+09:00',races:[raw]},race=Feed.convert(raw,feed);
const original=Cross.predict(race,weights,Risk,globalThis.ManshaRiskModel);
const exp=Expanded.predict(race,weights);
assert.deepEqual(exp.variants['4'],original.candidate4);
assert.deepEqual(exp.ordered_pairs.slice(0,2),original.pairs);
for(const n of [4,6,8,10]){
 const tickets=exp.variants[String(n)];
 assert.equal(tickets.length,n);
 assert.equal(new Set(tickets).size,n);
 if(n>4)assert.deepEqual(tickets.slice(0,n-2),exp.variants[String(n-2)]);
 for(const ticket of tickets){
  const parts=ticket.split('-').map(Number),positions=parts.slice(0,2).map(no=>race.lineup.findIndex(line=>line.includes(no)));
  assert.equal(new Set(parts).size,3);
  assert.notEqual(positions[0],positions[1],'the first two finishers must be from separate lines');
 }
}
const tampered=Feed.convert({...raw,result_top3:[3,2,5],payout_trifecta:999999},feed);
assert.deepEqual(Expanded.predict(tampered,weights),exp,'no actual results leak into the prediction');
assert.equal(Expanded.predict(race,weights).version,Expanded.VERSION);
const baseline=Old.freeze(race,weights,{now}),shadow=Shadow.freeze(race,baseline,weights,now);
assert.ok(shadow);
assert.equal(shadow.schema,Shadow.SCHEMA);
assert.deepEqual(shadow.variants['4'],baseline.forecast.candidate4);
assert.equal(Shadow.freeze(race,baseline,weights,Date.parse(date+'T16:30:00+09:00')),null,'no retroactive freeze');
const changed=Feed.convert(raw,{...feed,generated_at:date+'T09:05:00+09:00'});
assert.throws(()=>Shadow.freeze(changed,baseline,weights,now),/source|frozen/i,'must not silently rescore from a newer feed');
const other=JSON.parse(JSON.stringify(race));other.riders[1].score=110;
assert.throws(()=>Shadow.freeze(other,baseline,weights,now),/mismatch/i,'frozen original 4 must remain identical');
const winner=exp.variants['6'][4],parts=winner.split('-').map(Number);
const actual={race_id:shadow.race_id,race:{start},identity:shadow.identity,
 source_updated_at:date+'T17:05:00+09:00',collected_at:date+'T17:25:00+09:00',
 combos:[{key:winner,trio:parts,payout:12340}]};
const tested=Shadow.grade(shadow,actual,late);
assert.equal(tested.status,'evaluated');
assert.equal(tested.values['4'].payout,0);
assert.equal(tested.values['6'].payout,12340);
assert.equal(tested.values['8'].payout,12340);
assert.equal(tested.values['10'].payout,12340);
assert.equal(Shadow.grade(shadow,null,late).status,'pending');
assert.equal(Shadow.grade(shadow,{...actual,identity:[]},late).status,'excluded');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'crossline-expanded-'));
(async()=>{
 try{
  const baseDir=path.join(tmp,'data/crossline_selected',date),resultsDir=path.join(tmp,'data/routed_history',date);
  const modelsDir=path.join(tmp,'reports/mansha');fs.mkdirSync(baseDir,{recursive:true});fs.mkdirSync(modelsDir,{recursive:true});fs.mkdirSync(resultsDir,{recursive:true});
  fs.writeFileSync(path.join(modelsDir,'crossline-pair-third-v1.json'),JSON.stringify({models:weights}));
  const originalFile=path.join(baseDir,Shadow.hash(shadow.race_id));
  fs.writeFileSync(originalFile,JSON.stringify(baseline)+'\n');
  const before=fs.readFileSync(originalFile,'utf8');
  assert.equal(Shadow.capture(feed,{root:tmp,now,weights}).new,1);
  assert.equal(Shadow.capture(feed,{root:tmp,now:now+1000,weights}).existing,1);
  const first=Shadow.report(tmp,now);
  assert.equal(first.summary.selected.races+first.summary.skipped.races,1);
  assert.equal(first.summary.all.evaluated,0);
  assert.equal(first.summary.all.variants['10'].stake,0,'pending must never count as a bet');
  fs.writeFileSync(path.join(resultsDir,'results.json'),JSON.stringify({[shadow.race_id]:actual})+'\n');
  const scored=Shadow.report(tmp,late);
  assert.equal(scored.summary.all.evaluated,1);
  assert.equal(scored.summary.all.variants['6'].payout,12340);
  assert.equal(scored.summary.all.variants['4'].payout,0);
  assert.equal(scored.by_date[date].all.variants['10'].hits,1);
  assert.equal(scored.summary.all.variants['6'].trim1,null);
  assert.equal(fs.readFileSync(originalFile,'utf8'),before,'legacy 4-point snapshot untouched');
  const result=await Shadow.run({root:tmp,now:late,fetcher:async()=>feed});
  assert.equal(result.evaluation.summary.all.evaluated,1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp,'data/crossline_expanded/evaluation.json'),'utf8')).schema,'tk-crossline-expanded-evaluation/v1');
  assert.equal(Shadow.capture(feed,{root:path.join(tmp,'missing'),now,weights}).baseline_missing,1);
  console.log('PASS crossline expansion: 4/6/8/10 ranking, first write, identity, results isolation, ROI and UI data');
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
