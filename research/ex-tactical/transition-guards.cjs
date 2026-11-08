'use strict';
/* Research-only EX tactical transition feasibility / evidence ledger.
 * Not a predictor, not fitted probabilities, not historical ground truth.
 */
const METRICS=Object.freeze(['kamashi','tsuppari','chigiri','chigirarare','tobitsuki','seri']);
function unique(numbers){return Array.isArray(numbers)&&numbers.length===new Set(numbers).size&&numbers.every(Number.isInteger);}
function lineEdges(line){
 if(!unique(line)||line.length<1)throw Error('INVALID_LINE');
 return line.slice(1).map((r,i)=>({front:line[i],follower:r,position:i+2,key:line[i]+'>'+r}));
}
function connectedSegments(line,edges={}){
 const links=lineEdges(line),segments=[[line[0]]],unknown=[];
 for(const e of links){
  const mode=edges[e.key]||'unobserved';
  if(!['holds','breaks','unobserved'].includes(mode))throw Error('INVALID_EDGE_STATE');
  if(mode==='holds')segments.at(-1).push(e.follower);
  else {segments.push([e.follower]);if(mode==='unobserved')unknown.push(e.key);}
 }
 return {line:[...line],links:links.map(e=>({...e,status:edges[e.key]||'unobserved'})),segments,unknown,
  rule:'Each follower connects to the wheel immediately ahead; lost leader-to-marker connection does not prove third rider lost marker.'};
}
function seatOpportunity({lineup,order,leader,candidate,incumbent=null,incumbentDetached=false,hasOutsideLane=false,documentedContested=false}){
 if(!Array.isArray(lineup)||!lineup.every(unique)||!unique(order)||
   order.length!==lineup.flat().length||order.some(n=>!lineup.flat().includes(n)))
  return {status:'invalid',reason:'inconsistent field'};
 const leaderLine=lineup.find(l=>l.includes(leader)),candidateLine=lineup.find(l=>l.includes(candidate));
 if(!leaderLine||!candidateLine||leaderLine===candidateLine)return {status:'incompatible',reason:'not an opposing line'};
 if(candidateLine.length>1&&candidateLine[0]!==candidate)return {status:'incompatible',reason:'not opponent line head or solo'};
 const li=order.indexOf(leader),ci=order.indexOf(candidate),inc=order.indexOf(incumbent);
 if(li<0||ci<0)return {status:'invalid',reason:'unknown position'};
 const intervening=Math.abs(li-ci)-1;
 if(intervening>1)return {status:'unobserved',reason:'approach from multiple intervening riders needs time-resolved passing evidence'};
 if(!hasOutsideLane)return {status:'unobserved',reason:'no outside approach/corner passage was observed'};
 if(incumbent!==null&&!incumbentDetached){
  if(!documentedContested)return {status:'unobserved',reason:'incumbent occupied; contest declaration or observed contest is missing'};
  return {status:'contested_attempt_possible',reason:'occupied seat + observed/declared contest; no win assumed'};
 }
 return {status:'vacant_approach_possible',reason:'vacancy and a feasible adjacent approach; success not observed'};
}
function effectiveSeparation(head,follower,prior=.22,priorN=20){
 const inputs=[head,follower].map(x=>{
   if(!x||!Number.isInteger(x.events)||!Number.isInteger(x.opportunities)||
      x.opportunities<1||x.events<0||x.events>x.opportunities)return null;
   return {p:(x.events+prior*priorN)/(x.opportunities+priorN),n:x.opportunities,source:x};
 }).filter(Boolean);
 if(!inputs.length)return {status:'unobserved',relative_signal:null,confidence:0,effective_n:0};
 // Same line-break event is described from two role perspectives.
 // Do not sum two independent risk events or multiply rates.
 const w=inputs.map(x=>x.n/(x.n+priorN));
 const p=inputs.reduce((sum,x,i)=>sum+x.p*w[i],0)/w.reduce((s,x)=>s+x,0);
 return {status:inputs.length===2?'pair_heuristic':'single_side_heuristic',
  relative_signal:Math.round((p-prior)*10000)/10000,
  confidence:Math.max(...w),
  effective_n:Math.max(...inputs.map(x=>x.n)),
  basis:'Weighted shrinkage of correlated event perspectives, NOT calibrated P(detach); no double count.'};
}
function exDeltaLabel({before,after,metadata}){
 const m=metadata||{};
 if(!m.sameRider||!m.sameCounterDefinition||!m.sameWindow||!m.refreshConfirmed||
   m.interveningStarts!==1||!m.preStartSnapshot||!m.postRaceSnapshot)
  return {status:'unobserved',reason:'non-isolated start, changed window or unknown refresh'};
 if(!before||!after)return {status:'unobserved',reason:'missing count pair'};
 const dt=after.opportunities-before.opportunities,ds=after.events-before.events;
 if(!Number.isInteger(dt)||!Number.isInteger(ds)||dt<0||ds<0||ds>dt||dt>1)
  return {status:'unobserved',reason:'count delta incompatible with one clearly defined race attempt'};
 return {status:'candidate_only',attempted:dt===1,success:ds===1,
   evidence:'snapshot-delta requiring independent report or source confirmation before ground truth'};
}
module.exports={METRICS,lineEdges,connectedSegments,seatOpportunity,effectiveSeparation,exDeltaLabel};
