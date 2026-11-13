'use strict';
const assert=require('node:assert/strict');
const model=require('../scripts/crossline-phase4.cjs');
const replay=require('../scripts/crossline-phase4-replay.cjs');
const Study=require('../scripts/mansha-crossline-pair-third.cjs');
const lines=[[1,2],[3,4],[5,6],[7]];
function synthetic(i,date='2026-07-12'){
 const e=Array.from({length:7},(_,n)=>{
  const no=n+1,line=lines.findIndex(g=>g.includes(no))+1, role=lines[line-1].indexOf(no)+1;
  return {no,score:106-n*2+(i%3)*.2,rankIndex:n,scoreZ:(3-n)*.5,
   role,line:String(line),lineSize:lines[line-1].length,style:role===1?'逃':'追'};
 });
 const first=i%7+1,a=e[first-1],b=e.find(x=>x.no!==first&&x.line!==a.line&&x.no===((i+2)%7+1))||
 e.find(x=>x.no!==first&&x.line!==a.line);
 const third=e.find(x=>x.no!==a.no&&x.no!==b.no&&x.line!==a.line&&x.line!==b.line)||
 e.find(x=>x.no!==a.no&&x.no!==b.no);
 const c={date,venue:'合成',raceNo:i+1,n:7,e,byNo:new Map(e.map(x=>[x.no,x])),
  finish:[a.no,b.no,third.no],cross:true,cat:'A7',riskPriority:true,payout:5000+(i%6)*1330};
 return c;
}
const train=Array.from({length:225},(_,i)=>synthetic(i));
const old={regular:{winner:{weights:[.6,.2,.13,.36,-.49,-.03,.43,.38,-.58,0,0,0]},
 second:{weights:[.3,.18,-.02,.3,-.17,-.17,.44,.24,-.1,0,0,0]}},
 third:{weights:[.18,-.05,.04,.04,-.08,.04,-.08,-.06,-.19,.19,.07,-.26]}};
const fitted=model.fit(train);
assert.equal(fitted.second.trained,225);assert.equal(fitted.third.trained,225);
assert.equal(fitted.second.weights.length,22);assert.equal(fitted.third.weights.length,22);
assert.equal(model.weightsOK(fitted),true);
assert.deepEqual(model.fit(train),fitted,'training is deterministic');
assert.throws(()=>model.fit([...train,synthetic(0,'2026-09-02')]),/Post-August/);
assert.throws(()=>model.fit([]),/Missing training/);
const test=synthetic(9,'2026-10-04'),prediction=model.predict(test,old,fitted);
assert.deepEqual(model.predict(test,old,fitted),prediction,'ticket creation deterministic');
for(const [mode,tickets] of Object.entries(prediction.tickets)){
 assert.equal(tickets.length,4,mode);
 assert.equal(new Set(tickets).size,4,mode);
 for(const key of tickets){const [a,b,t]=key.split('-').map(Number);
  assert.equal(new Set([a,b,t]).size,3);
  assert.notEqual(test.byNo.get(a).line,test.byNo.get(b).line);
 }
}
assert.deepEqual(prediction.tickets.legacy4,[...Study.tickets(test,'regular',2,'trained2',old).t]);
const changed={...test,finish:[test.finish[2],test.finish[0],test.finish[1]],payout:123456};
assert.deepEqual(model.predict(changed,old,fitted),prediction,'outcomes/payout are never predictor inputs');
const p1=model.orderedPairs(test,old,fitted);
assert.ok(p1[0].score>=p1[1].score);
const {report,rows}=replay.evaluate([test,changed],old,fitted);
assert.equal(rows.length,2);
assert.equal(report.periods.octnov.races,2);
for(const m of replay.MODES)assert.equal(report.periods.octnov.strategies[m].stake,800);
assert.deepEqual(replay.evaluate([test,changed],old,fitted),{report,rows});
console.log('phase4 conditional model: deterministic training, no outcome leakage, four tickets, evaluation OK');
