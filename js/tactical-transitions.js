/* EX-guided tactical transition constraints. Independent of selection and purchase policy.
 * Source counts are conditional event statistics, not the frequency of a tactical choice.
 * UMD for the LAB mobile browser and Node replay.
 */
(function(root){
'use strict';
const VERSION='tactical-transitions-v2.0';
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const healthy=m=>m&&Number.isInteger(m.events)&&Number.isInteger(m.opportunities)&&m.opportunities>0&&
 m.events>=0&&m.events<=m.opportunities;
function combinedBreakEvidence(head,behind){
 const h=healthy(head?.ex_metric_counts?.chigiri)?head.ex_metric_counts.chigiri:null;
 const f=healthy(behind?.ex_metric_counts?.chigirarare)?behind.ex_metric_counts.chigirarare:null;
 const inputs=[h,f].filter(Boolean).map(v=>{
  const w=v.opportunities/(v.opportunities+20);
  return {estimate:(v.events+20*.22)/(v.opportunities+20),w,n:v.opportunities};
 });
 if(!inputs.length)return {basis:'no_EX',risk:.22,confidence:0};
 const weight=inputs.reduce((s,x)=>s+x.w,0);
 // The two indicators can describe the SAME line separation. Never sum them as independent risks.
 return {basis:inputs.length===2?'joint_ex':'single_ex',
  risk:inputs.reduce((s,x)=>s+x.estimate*x.w,0)/weight,
  confidence:Math.max(...inputs.map(x=>x.w)),
  effective_n:Math.max(...inputs.map(x=>x.n))};
}
function followerOutcome({leader,follower,leaderAbility=.5,followerAbility=.5,acceleration=.1,resist=false}){
 const baseTrack=Number.isFinite(follower?.ex_track_base)?follower.ex_track_base:follower?.track;
 if(!Number.isFinite(baseTrack)||!Number.isFinite(leaderAbility)||!Number.isFinite(followerAbility))throw Error('INVALID_FOLLOW_PROFILE');
 const core=.48+.42*baseTrack-acceleration-(resist?.08:0)+.08*(followerAbility-leaderAbility);
 const ex=combinedBreakEvidence(leader,follower);
 const shift=(ex.risk-.22)*ex.confidence*.17;
 return {keep:clamp(core-shift,.18,.9),ex,shift,
  input:'leader acceleration + relative wheel tracking + one combined EX separation observation'};
}
function splitLine(line,status){
 if(!Array.isArray(line)||line.length<2||new Set(line).size!==line.length||
    !['holds','breaks'].includes(status))throw Error('INVALID_LINE_GAP');
 const edges=line.slice(1).map((no,i)=>({
  from:line[i],to:no,status:i===0?status:'not_observed',
  explanation:i===0?'leader-to-marker branch':'follow-up links have no observed event label'
 }));
 return {segments:status==='holds'?[line.slice()]:[[line[0]],line.slice(1)],
  edges,firstBreak:status==='breaks'};
}
function gapReorder(order,line,controller){
 if(!Array.isArray(order)||new Set(order).size!==order.length||
    !Array.isArray(line)||!line.includes(controller)||line[0]!==controller)throw Error('INVALID_GAP_ORDER');
 const followers=line.slice(1);
 if(!followers.length)return order.slice();
 if(followers.some(no=>!order.includes(no)))throw Error('MISSING_FOLLOWERS');
 // The follower's line tail stays together. A third rider cannot teleport
 // into the lead's wheel when the second rider is dropped.
 return [...order.filter(no=>!followers.includes(no)),...followers];
}
function seatOpportunity(order,lineup,controller,opponent,ctx={}){
 if(!Array.isArray(order)||!Array.isArray(lineup)||new Set(order).size!==order.length||!lineup.every(x=>Array.isArray(x)&&new Set(x).size===x.length))throw Error('INVALID_SEAT_INPUT');
 if(opponent==null)return {allowed:false,why:'no nearby candidate'};
 const leaderLine=lineup.find(l=>l.includes(controller));
 const challengerLine=lineup.find(l=>l.includes(opponent));
 if(!leaderLine||leaderLine[0]!==controller||!challengerLine||leaderLine===challengerLine||
    challengerLine[0]!==opponent)return {allowed:false,why:'candidate is not an opposing line head or solo'};
 const ci=order.indexOf(controller),fi=order.indexOf(leaderLine[1]),oi=order.indexOf(opponent);
 if(ci<0||fi!==ci+1||oi!==fi+1)return {allowed:false,why:'opponent is not immediately behind the separated marker'};
 if(!ctx.accelerationApproach)return {allowed:false,why:'no continuous approach scenario'};
 if(!Number.isFinite(ctx.seatTrait)||ctx.seatTrait<.40)return {allowed:false,why:'no defensible approach tendency'};
 // Even an adjacent rival's ability to pass is only a possible attempt.
 const raw=clamp(.06+ctx.seatTrait*.12+(ctx.tobitsukiDelta||0),.04,.24);
 return {allowed:true,candidate:opponent,attemptWeight:raw,
  why:'adjacent opposing leader with a continuous approach; seat takeover is only one branch'};
}
function gapBranches({order,lineup,controller,gap,profile,tactic,controllerIsAttacker}){
 const line=lineup.find(l=>l[0]===controller);
 if(!line)throw Error('CONTROLLER_NOT_LINE_HEAD');
 if(gap!=='breaks'||line.length<2){
  return [{order:order.slice(),seat:null,seatState:'occupied',weight:1,links:line.length>1?splitLine(line,'holds'):null}];
 }
 const reordered=gapReorder(order,line,controller),links=splitLine(line,'breaks');
 // Seat insertion is an explicit branch and never follows automatically from a gap.
 const candidate=order[order.indexOf(line[1])+1];
 const p=profile?.get(candidate);
 const candidateAllowed=seatOpportunity(order,lineup,controller,candidate,{
  accelerationApproach:controllerIsAttacker&&tactic==='kamashi',
  seatTrait:p?.seat,tobitsukiDelta:p?.ex_tobitsuki_delta
 });
 if(!candidateAllowed.allowed){
  return [{order:reordered,seat:null,seatState:'vacant',weight:1,links,
   reason:candidateAllowed.why}];
 }
 const without={order:reordered.slice(),seat:null,seatState:'vacant',weight:1-candidateAllowed.attemptWeight,links};
 const seatOrder=reordered.filter(n=>n!==candidate);
 const ix=seatOrder.indexOf(controller);
 seatOrder.splice(ix+1,0,candidate);
 const withSeat={order:seatOrder,seat:candidate,seatState:'attempted_takeover',weight:candidateAllowed.attemptWeight,links,
  reason:candidateAllowed.why};
 return [without,withSeat];
}
const api={VERSION,combinedBreakEvidence,followerOutcome,splitLine,gapReorder,seatOpportunity,gapBranches};
if(typeof module!=='undefined')module.exports=api;
root.LabTacticalTransitions=api;
})(typeof globalThis!=='undefined'?globalThis:this);
