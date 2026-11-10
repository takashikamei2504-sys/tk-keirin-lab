/* Mansha risk score: standalone pre-race diagnostics, NOT a ticket engine. */
(function(root){'use strict';
const VERSION='mansha-risk-v1.0';
const CATS=['A7','C7','S7','S9'];
const FEATURE_NAMES=['intercept','C7','S7','S9','range_lt8','range_ge12','top_gap_lt2','top_gap_ge5',
 'lines_ge4','solo_ge2','top2_other_line','line_gap_lt2','escape_ge3','escape_zero','top1_escape','fourlines_topgap'];
const bounded=(p)=>Math.max(1e-5,Math.min(1-1e-5,p));
const logistic=x=>x>0?1/(1+Math.exp(-x)):Math.exp(x)/(1+Math.exp(x));
const logit=p=>Math.log(bounded(p)/(1-bounded(p)));
function columns(r) {
 const category=String(r?.cat||'');
 if(!CATS.includes(category))throw Error('Risk score requires A7/C7/S7/S9');
 const requireFinite=['range','gap','lineCount','solo','top2Diff','lineGap','leaderCount','top1Escape'];
 for(const k of requireFinite)if(!Number.isFinite(Number(r[k])))throw Error('Missing pre-race feature: '+k);
 return [1,Number(category==='C7'),Number(category==='S7'),Number(category==='S9'),
  Number(r.range<8),Number(r.range>=12),Number(r.gap<2),Number(r.gap>=5),
  Number(r.lineCount>=4),Number(r.solo>=2),Number(r.top2Diff===1),Number(r.lineGap<2),
  Number(r.leaderCount>=3),Number(r.leaderCount===0),Number(r.top1Escape===1),
  Number(r.lineCount>=4&&r.gap<2)];
}
function featuresFromRace(r){
 if(!r||!Array.isArray(r.riders)||!Array.isArray(r.lineup))throw Error('Missing lineup and riders');
 const e=r.riders,n=e.length;
 if(![7,9].includes(n)||r.lineup.flat().length!==n)throw Error('Invalid field size');
 if(e.some(x=>!Number.isFinite(Number(x.score))||!['逃','追','両'].includes(x.style)))throw Error('Missing score/style');
 const keys=e.map(x=>String(x.meta?.rank||'').normalize('NFKC'));
 if(keys.some(k=>!(/^(S[12]|A[123])$/.test(k))))throw Error('Missing race rank');
 let cat=keys.some(k=>k.startsWith('S'))?'S':keys.every(k=>k==='A3')?'C':'A';cat+=n;
 if(!CATS.includes(cat))throw Error('Unsupported race category '+cat);
 const sorted=e.slice().sort((a,b)=>Number(b.score)-Number(a.score));
 const lOf=new Map();r.lineup.forEach((line,i)=>line.forEach(no=>lOf.set(Number(no),i)));
 if(lOf.size!==n||e.some(x=>!lOf.has(Number(x.no))))throw Error('Broken lineup');
 const mean=line=>line.reduce((sum,no)=>sum+Number(e.find(x=>Number(x.no)===Number(no)).score),0)/line.length;
 const meanScores=r.lineup.map(mean).sort((a,b)=>b-a);
 const scores=sorted.map(x=>Number(x.score));
 const leader=e.filter(x=>x.style==='逃');
 return {cat,range:scores[0]-scores.at(-1),gap:scores[0]-scores[1],
  lineCount:r.lineup.length,solo:r.lineup.filter(line=>line.length===1).length,
  top2Diff:Number(lOf.get(Number(sorted[0].no))!==lOf.get(Number(sorted[1].no))),
  lineGap:meanScores[0]-meanScores[1],leaderCount:leader.length,
  top1Escape:Number(sorted[0].style==='逃'),leaderLines:new Set(leader.map(x=>lOf.get(Number(x.no)))).size};
}
function fit(records,lambda=.005){
 const data=records.filter(r=>CATS.includes(r.cat)).map(r=>({x:columns(r),y:Number(r.high)}));
 const w=new Array(FEATURE_NAMES.length).fill(0);
 // batch gradient, fixed training horizon and regularization, deterministic
 for(let step=0;step<950;step++){
  const g=new Array(w.length).fill(0);
  for(const {x,y} of data){
   let z=0;for(let j=0;j<w.length;j++)z+=w[j]*x[j];
   const error=logistic(z)-y;
   for(let j=0;j<w.length;j++)g[j]+=error*x[j];
  }
  for(let j=0;j<w.length;j++)w[j]-=.7*(g[j]/data.length+(j?lambda*w[j]:0));
 }
 const byCat={};for(const cat of CATS){const d=data.filter(t=>t.x[CATS.indexOf(cat)]===1); /* unused; calibrated base below */ }
 return {version:VERSION,training_rows:data.length,features:FEATURE_NAMES,weights:w,calibration:{a:0,b:1},thresholds:{}};
}
function rawProbability(r,model){
 const x=columns(r);if(model.features.join('|')!==FEATURE_NAMES.join('|'))throw Error('Model feature mismatch');
 return bounded(logistic(x.reduce((v,c,i)=>v+c*model.weights[i],0)));
}
function probability(r,model){const p=rawProbability(r,model);return bounded(logistic(model.calibration.a+model.calibration.b*logit(p)));}
function calibrate(model,validation){
 let a=0,b=1;
 // Platt scaling fit on the validation set, ridge around no adjustment
 const samples=validation.map(r=>({z:logit(rawProbability(r,model)),y:r.high}));
 for(let k=0;k<800;k++){
  let ga=0,gb=0;
  for(const x of samples){const d=logistic(a+b*x.z)-x.y;ga+=d;gb+=d*x.z}
  a-=.15*(ga/samples.length+.005*a);
  b-=.15*(gb/samples.length+.005*(b-1));
  b=Math.max(.25,Math.min(2.5,b));
 }
 model.calibration={a,b};
 return model;
}
function thresholdFromValidation(model,validation,fraction=.25){
 for(const cat of CATS){
  const p=validation.filter(r=>r.cat===cat).map(r=>probability(r,model)).sort((a,b)=>a-b);
  model.thresholds[cat]=p.length?{q75:p[Math.floor((1-fraction)*p.length)]??p.at(-1),
   q90:p[Math.floor(.90*p.length)]??p.at(-1),n:p.length}:null;
 }
 return model;
}
function score(r,model){
 const p=probability(r,model),threshold=model.thresholds[r.cat];
 if(!threshold)throw Error('Missing category threshold for '+r.cat);
 return {probability:p,percent:+(100*p).toFixed(1),
   band:p>=threshold.q90?'上位10%':p>=threshold.q75?'上位25%':'通常',
   priority:p>=threshold.q75,model_version:model.version};
}
if(typeof module!=='undefined')module.exports={VERSION,CATS,FEATURE_NAMES,columns,featuresFromRace,fit,calibrate,thresholdFromValidation,rawProbability,probability,score};
root.ManshaRisk={VERSION,CATS,FEATURE_NAMES,columns,featuresFromRace,rawProbability,probability,score};
})(typeof globalThis!=='undefined'?globalThis:this);
