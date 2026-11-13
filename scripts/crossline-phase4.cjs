#!/usr/bin/env node
'use strict';
// Phase 4 research-only conditional pair/third model.
// FIT ONLY on frozen Jun-Aug archive, never on later outcomes.
const Study=require('./mansha-crossline-pair-third.cjs');
const SCHEMA='crossline-conditional-v1';
const TRAIN_END='2026-09-01';
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
function softmax(z){const m=Math.max(...z),e=z.map(x=>Math.exp(x-m)),s=e.reduce((a,b)=>a+b,0);return e.map(x=>x/s);}
function secondFeatures(x,c,a){
 const firstFront=a.role===1,secondFront=x.role===1,other=a.line!==x.line;
 return [...Study.riderCols(x,c,a),
  +(a.line===x.line),+(firstFront&&secondFront),+(firstFront&&x.role===2),
  +(a.role===2&&secondFront),+(a.style==='逃'&&secondFront),
  +(a.style==='逃'&&x.style==='逃'),+(other&&x.lineSize>=3),
  +(other&&x.role===2),a.scoreZ*x.scoreZ,a.scoreZ-x.scoreZ];
}
function thirdFeatures(x,c,a,b){
 const outside=x.line!==a.line&&x.line!==b.line;
 const lineCount=new Set(c.e.map(r=>r.line)).size;
 return [...Study.riderCols(x,c,a,b),
  +(outside&&x.role===1),+(outside&&x.role===2),
  +(outside&&x.role>=3),+(outside&&x.lineSize===1),
  +(outside&&lineCount>=4),+(outside&&x.scoreZ>0),
  +(x.line===a.line&&a.style==='逃'),
  +(x.line===b.line&&b.style==='逃'),
  +(x.line===a.line&&a.role===1),
  +(x.line===b.line&&b.role===1)];
}
function trainSoftmax(rows,features,epochs=110,regularization=.02){
 if(rows.length<8)throw Error('Too few training rows');
 const width=features(rows[0].c.e[0],rows[0].c,rows[0].a,rows[0].b).length;
 let weights=Array(width).fill(0);
 for(let ep=0;ep<epochs;ep++){
  const grad=Array(width).fill(0);
  for(const row of rows){
   const f=row.options.map(x=>features(x,row.c,row.a,row.b));
   const p=softmax(f.map(x=>dot(x,weights)));
   for(let j=0;j<f.length;j++){
    const d=p[j]-Number(row.options[j].no===row.target);
    for(let k=0;k<width;k++)grad[k]+=d*f[j][k];
   }
  }
  const rate=.23/(1+ep*.018);
  for(let k=0;k<width;k++)weights[k]-=rate*(grad[k]/rows.length+regularization*weights[k]);
 }
 return {weights,trained:rows.length};
}
function fit(cards){
 if(!Array.isArray(cards)||!cards.length)throw Error('Missing training cards');
 if(cards.some(c=>!(c.date<TRAIN_END)||!Array.isArray(c.finish)||c.finish.length!==3))throw Error('Post-August training outcome forbidden');
 const second=cards.map(c=>{
  const a=c.byNo.get(c.finish[0]);return {c,a,options:c.e.filter(x=>x.no!==a.no),target:c.finish[1]};
 });
 const cross=cards.filter(c=>c.cross);
 const third=cross.map(c=>{
  const a=c.byNo.get(c.finish[0]),b=c.byNo.get(c.finish[1]);
  return {c,a,b,options:c.e.filter(x=>x.no!==a.no&&x.no!==b.no),target:c.finish[2]};
 });
 if(second.length<200||third.length<100)throw Error('Training scope too small');
 return {schema:SCHEMA,train_through:'2026-08-31',
  second:trainSoftmax(second,secondFeatures),third:trainSoftmax(third,thirdFeatures),
  notes:'Only final standings in Jun-Aug training, never fed to predictor. Sep-Nov is past-observed diagnostic, not a virgin holdout.'};
}
function weightsOK(model){
 return model?.schema===SCHEMA&&model?.train_through==='2026-08-31'&&
 Array.isArray(model?.second?.weights)&&model.second.weights.length===22&&
 Array.isArray(model?.third?.weights)&&model.third.weights.length===22&&
 model.second.weights.every(Number.isFinite)&&model.third.weights.every(Number.isFinite);
}
function orderedPairs(c,base,model){
 if(!weightsOK(model))throw Error('Missing fixed Phase4 weights');
 const w=base.regular.winner.weights;
 const winner=softmax(c.e.map(x=>dot(Study.riderCols(x,c),w)));
 const pairs=[];
 for(let i=0;i<c.e.length;i++){
  const a=c.e[i],possible=c.e.filter(x=>x.no!==a.no);
  const conditional=softmax(possible.map(x=>dot(secondFeatures(x,c,a),model.second.weights)));
  possible.forEach((b,j)=>{if(b.line!==a.line)pairs.push({a,b,score:Math.log(winner[i])+Math.log(conditional[j])});});
 }
 pairs.sort((x,y)=>y.score-x.score||x.a.no-y.a.no||x.b.no-y.b.no);
 return pairs;
}
function thirdOrder(c,pair,model){
 if(!weightsOK(model))throw Error('Missing fixed Phase4 weights');
 return c.e.filter(x=>x.no!==pair.a.no&&x.no!==pair.b.no)
 .sort((x,y)=>dot(thirdFeatures(y,c,pair.a,pair.b),model.third.weights)-
 dot(thirdFeatures(x,c,pair.a,pair.b),model.third.weights)||x.no-y.no);
}
function legacyThird(c,pair,base){
 return c.e.filter(x=>x.no!==pair.a.no&&x.no!==pair.b.no)
 .sort((x,y)=>dot(Study.riderCols(y,c,pair.a,pair.b),base.third.weights)-
 dot(Study.riderCols(x,c,pair.a,pair.b),base.third.weights)||x.no-y.no);
}
function makeTickets(pairs,thirdFn){
 const tickets=[],seen=new Set();
 for(const p of pairs.slice(0,2))for(const x of thirdFn(p).slice(0,2)){
  const key=p.a.no+'-'+p.b.no+'-'+x.no;
  if(!seen.has(key)){seen.add(key);tickets.push(key);}
 }
 return tickets;
}
function predict(c,base,model){
 if(!weightsOK(model))throw Error('Unvalidated phase4 weights');
 const oldPairs=Study.orderedPairs(c,'regular',base);
 const newPairs=orderedPairs(c,base,model);
 const legacyPairs=oldPairs.slice(0,2),conditionalPairs=newPairs.slice(0,2);
 const legacy=makeTickets(legacyPairs,p=>legacyThird(c,p,base));
 const pair4=makeTickets(conditionalPairs,p=>legacyThird(c,p,base));
 const third4=makeTickets(legacyPairs,p=>thirdOrder(c,p,model));
 const joint4=makeTickets(conditionalPairs,p=>thirdOrder(c,p,model));
 const ordered=ps=>ps.map(p=>p.a.no+'-'+p.b.no);
 return {tickets:{legacy4:legacy,conditional_pair4:pair4,cross_third4:third4,conditional_joint4:joint4},
  pairs:{legacy:ordered(legacyPairs),conditional:ordered(conditionalPairs)},
  all_pair_ranks:{legacy:ordered(oldPairs),conditional:ordered(newPairs)}};
}
module.exports={SCHEMA,TRAIN_END,secondFeatures,thirdFeatures,fit,weightsOK,orderedPairs,thirdOrder,predict,softmax};