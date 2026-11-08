'use strict';
/* Research-only time-split predictive test. Every category estimate is trained
 * through Oct15, evaluated on Oct16-Nov07; no heldout result is predictor input.
 * These are 3rd-place-or-better associations, NOT official EX statistics.
 */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const p=path.join(__dirname,'../research/b-axis/ex_context_train_holdout_2026.json');
const x=JSON.parse(fs.readFileSync(p,'utf8'));
assert(x.splits.train.nRaces>200&&x.splits.holdout.nRaces>200);
const keys=['position','race_type','bank_length','weather','time_band'];
function loss(top3,n,p){return top3*(1-p)**2+(n-top3)*p*p;}
const result={};
for(const axis of keys){
 let n=0,base=0,learned=0,learnedN=0,totalN=0,categories=new Set();
 const global=x.splits.train.population[axis]||{},personal=x.splits.train.riders;
 const test=x.splits.holdout.riders;
 for(const [id,groups] of Object.entries(test)){
  for(const [key,row] of Object.entries(groups[axis]||{})){
   if(!row?.n)continue;
   const prior=global[key];
   if(!prior||prior.n<15)continue;
   const p0=(prior.top3+3)/(prior.n+6),r=personal?.[id]?.[axis]?.[key];
   const rN=r?.n||0;
   const q=rN>=3?Math.max(.001,Math.min(.999,p0+((r.top3+p0*24)/(rN+24)-p0)*Math.min(1,rN/12))):p0;
   n+=row.n;totalN++;categories.add(key);
   if(rN>=3)learnedN+=row.n;
   base+=loss(row.top3,row.n,p0);
   learned+=loss(row.top3,row.n,q);
  }
 }
 result[axis]={holdoutPersons:n,sampledRoles:totalN,trainedProfileObservations:learnedN,categories:[...categories].sort(),
  brierGlobal:n?+(base/n).toFixed(6):null,brierRider:n?+(learned/n).toFixed(6):null,
  improvement:n?+((base-learned)/n).toFixed(6):null};
}
const report={schema:'tk-b-axis-ex-context-holdout/v1',dates:{trainStart:x.training_start,
 trainEnd:'2026-10-15',holdoutStart:x.train_end_exclusive,holdoutEnd:x.training_end},
 aggregate:{train:x.splits.train.nRaces,holdout:x.splits.holdout.nRaces},
 categories:result,
 note:'Official WINTICKET EX metrics not obtained. This tests only public finish-derived stratification. A person appears multiple times across axes; rates are not independent. Historical snapshot collection times not reconstructed.'};
console.log('B_AXIS_EX11_HOLDOUT '+JSON.stringify(report));
if(process.env.B_AXIS_REPORT_PATH)fs.writeFileSync(process.env.B_AXIS_REPORT_PATH,JSON.stringify(report,null,2)+'\n');
