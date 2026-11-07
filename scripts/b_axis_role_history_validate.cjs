'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/b_axis_role_history.json'),'utf8'));
const perRole=(size,role)=>{
 const prefix=size+'|'+role+'|',train=Object.entries(data.train.followScoreGap).filter(([k])=>k.startsWith(prefix)),hold=Object.entries(data.holdout.followScoreGap).filter(([k])=>k.startsWith(prefix));
 const N=train.reduce((s,[,x])=>s+x.n,0),H=train.reduce((s,[,x])=>s+x.top3,0);
 const p=H/N;if(!(p>0&&p<1))throw Error('missing train prior');
 let base=0,delta=0,n=0,top3=0;
 for(const [key,x] of hold){
  const sample=data.train.followScoreGap[key]||{n:0,top3:0};
  const prior=(sample.top3+p*40)/(sample.n+40);
  n+=x.n;top3+=x.top3;
  base+=x.top3*(1-p)**2+(x.n-x.top3)*p*p;
  delta+=x.top3*(1-prior)**2+(x.n-x.top3)*prior*prior;
 }
 return {size,role,trainN:N,holdoutN:n,trainTop3Rate:+(p*100).toFixed(2),
  holdoutTop3Rate:+(top3/n*100).toFixed(2),brierConstant:+(base/n).toFixed(5),
  brierScoreGap:+(delta/n).toFixed(5),improvement:+((base-delta)/n).toFixed(5)};
};
const outcome=[perRole(7,'second'),perRole(7,'thirdPlus'),perRole(9,'second'),perRole(9,'thirdPlus')];
assert(data.training_start==='2026-06-22'&&data.training_end==='2026-11-07');
assert(data.train_end_exclusive==='2026-10-16');
assert(data.all.eligible===data.train.eligible+data.holdout.eligible);
assert(data.all.byCarCount[7].races===data.all.runners[7]);
assert(data.all.byCarCount[9].races===data.all.runners[9]);
assert.equal(data.provenance.actual_b_available,false);
assert.equal(data.provenance.coverage_not_one_year,true);
assert.equal(outcome.length,4);
process.stdout.write('B_AXIS_ROLE_VALIDATION '+JSON.stringify({days:data.number_of_days,all:data.all.eligible,train:data.train.eligible,holdout:data.holdout.eligible,metrics:outcome,
 limitation:'This measures top-three finish association by published line role and score delta, NOT observed following/detachment/B. Holdout selection from available archive is nonrandom. No robust 9-rider score-delta gain.'})+'\n');
