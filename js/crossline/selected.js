/* TK KEIRIN LAB: independent legacy cross-line 4-ticket model + Phase 3 race gate.
 * Deterministic, pre-race-only inputs. Neither results nor payouts are read. */
(function(root){'use strict';
const VERSION='crossline-selected-v1-20261114';
const dot=(x,w)=>x.reduce((a,b,i)=>a+b*w[i],0);
const softmax=xs=>{const m=Math.max(...xs),y=xs.map(x=>Math.exp(x-m)),s=y.reduce((a,b)=>a+b,0);return y.map(x=>x/s);};
function card(r){
 if(!r||!Array.isArray(r.riders)||r.riders.length!==7||!Array.isArray(r.lineup))throw Error('男子7車の出走表が必要です');
 const positions=new Map();
 for(let i=0;i<r.lineup.length;i++)for(let j=0;j<r.lineup[i].length;j++){
  const no=+r.lineup[i][j];if(positions.has(no))throw Error('ライン車番が重複');
  positions.set(no,{line:String(i+1),role:j+1,lineSize:r.lineup[i].length});
 }
 if(positions.size!==7)throw Error('ラインが不完全です');
 const es=r.riders.map(x=>{
  if(!positions.has(+x.no)||!Number.isFinite(+x.score)||+x.score<50||+x.score>145||!['逃','両','追'].includes(x.style))throw Error('出走表が不完全です');
  return {no:+x.no,score:+x.score,style:x.style,...positions.get(+x.no)};
 });
 if(new Set(es.map(x=>x.no)).size!==7)throw Error('車番が重複');
 const sorted=es.slice().sort((a,b)=>b.score-a.score||a.no-b.no);
 const avg=es.reduce((a,b)=>a+b.score,0)/7;
 const sd=Math.sqrt(es.reduce((a,b)=>a+(b.score-avg)**2,0)/7);
 const ranks=new Map(sorted.map((x,i)=>[x.no,i]));
 for(const x of es){x.rankIndex=ranks.get(x.no);x.scoreZ=Math.max(-3,Math.min(3,(x.score-avg)/Math.max(sd,3)));}
 return {e:es,n:7};
}
function features(x,c,first=null,second=null){
 const last=c.n-1;
 return [x.scoreZ,(last-x.rankIndex)/last,+(x.role===1),+(x.role===2),+(x.role>=3),+(x.lineSize===1),+(x.lineSize>=3),+(x.style==='逃'),+(x.style==='追'),+(x.line===first?.line),+(x.line===second?.line),+(!!first&&!!second&&x.line!==first.line&&x.line!==second.line)];
}
function validWeights(models){
 return !!(models?.regular?.winner?.weights&&models?.regular?.second?.weights&&models?.third?.weights)&&
 [models.regular.winner.weights,models.regular.second.weights,models.third.weights].every(w=>Array.isArray(w)&&w.length===12&&w.every(Number.isFinite));
}
function pairsAndTickets(c,models){
 if(!validWeights(models))throw Error('従来別線4点モデルの固定学習係数が不正');
 const first=softmax(c.e.map(x=>dot(features(x,c),models.regular.winner.weights)));
 const second=softmax(c.e.map(x=>dot(features(x,c),models.regular.second.weights)));
 const options=[];
 for(let i=0;i<c.e.length;i++)for(let j=0;j<c.e.length;j++){
  const a=c.e[i],b=c.e[j];if(i===j||a.line===b.line)continue;
  options.push({a,b,s:Math.log(first[i])+Math.log(second[j])});
 }
 options.sort((a,b)=>b.s-a.s||a.a.no-b.a.no||a.b.no-b.b.no);
 const top=options.slice(0,2),tickets=[];
 for(const p of top){
  const thirds=c.e.filter(x=>x.no!==p.a.no&&x.no!==p.b.no).sort((x,y)=>dot(features(y,c,p.a,p.b),models.third.weights)-dot(features(x,c,p.a,p.b),models.third.weights)||x.no-y.no).slice(0,2);
  for(const t of thirds)tickets.push([p.a.no,p.b.no,t.no].join('-'));
 }
 if(tickets.length!==4||new Set(tickets).size!==4)throw Error('4点の算出に失敗');
 return {pairs:top.map(p=>[p.a.no,p.b.no]),candidate4:tickets};
}
function predict(r,models,riskLib,riskModel){
 if(!riskLib?.featuresFromRace||!riskLib?.score)throw Error('万車リスクモデルを取得できません');
 const f=riskLib.featuresFromRace(r);
 if(!['A7','C7'].includes(f.cat))return {version:VERSION,category:f.cat,eligible:false,reason:'A級・チャレンジ7車のみ対象',risk:null,pairs:[],candidate4:[],tickets:[],stake:0};
 const c=card(r),q=pairsAndTickets(c,models);
 const risk=riskLib.score(f,riskModel);
 const a=q.pairs[0],b=q.pairs[1],reversed=a[0]===b[1]&&a[1]===b[0];
 const eligible=!!risk.priority&&!reversed;
 const reason=!risk.priority?'万車リスク上位25%の対象外':reversed?'上位2ペアが裏表関係':'購入候補に該当';
 return {version:VERSION,category:f.cat,eligible,reason,
  risk:{percent:risk.percent,band:risk.band,priority:risk.priority,model_version:risk.model_version},
  reverse_pair:reversed,pairs:q.pairs,candidate4:q.candidate4,tickets:eligible?q.candidate4.slice():[],stake:eligible?400:0};
}
const api={VERSION,card,features,validWeights,pairsAndTickets,predict};
if(typeof module!=='undefined')module.exports=api;
root.CrosslineSelected=api;
})(typeof globalThis!=='undefined'?globalThis:this);
