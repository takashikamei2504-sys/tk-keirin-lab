/* Relative-wheel follower evaluation; no artificial distance penalty for 3rd riders.
 * Pre-race scores and rider-level historical RESULT association are not observed "detachment rates".
 */
(function(root){'use strict';
const clip=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const Ex=typeof module!=='undefined'?require('./ex-data.js'):root.BAxisEx;
function value(features,no,name,d=.5){
 const v=features?.[no]?.[name]?.value;return Number.isFinite(v)?clip(v):d;
}
function history(data,rider,raceDate){
 if(!data||!data.training_end||!raceDate||raceDate<=data.training_end||data.provenance?.actual_b_available)return null;
 const id=String(rider.meta?.rider_id||'').replace(/^0+(?=\d)/,'');
 const result=data.rider_roles?.[id]||null;
 return result?.n>=6?result:null;
}
function profile(features,follower,leader,options={}){
 const a=value(features,follower.no,'ability',.4),s=value(features,follower.no,'sprint',.4);
 const raw=value(features,follower.no,'track',.55),pre=value(features,leader.no,'sprint',.4);
 const scoreGap=Number(follower.score)-Number(leader.score);
 const relative=Number.isFinite(scoreGap)?clip((scoreGap+12)/24):.5;
 const riderHistory=history(options.history,follower,options.date);
 const empirical=riderHistory?clip((riderHistory.top3+4)/(riderHistory.n+8),.04,.96):null;
 // Avoid treating top-three finishes as actual wheel tracking. Tiny adjustment only.
 const exRisk=options.exInput?Ex.followerRisk(options.exInput,leader,follower,options.asOf):null;
 const exAdjustment=exRisk?(exRisk.risk-.22)*Math.min(.20,exRisk.weight*.30):0;
 const track=clip(raw*.40+a*.33+s*.14+relative*.13+(empirical!==null?(empirical-.47)*.06:0)-exAdjustment,.18,.95);
 const accelerationMismatch=Math.max(0,pre-s);
 const fast=options.fast? .12:0;
 const switchGap=options.switched?.65:0;
 const wheelGap=.55+Math.max(0,.59-track)*1.1+accelerationMismatch*.35+fast+switchGap+
   (exRisk?(exRisk.risk-.22)*exRisk.weight*.65:0);
 const local=wheelGap>=1.52?'detached':wheelGap>=1.11?'gap_opened':'following';
 return {followTarget:leader.no,tracking:Math.round(track*1000)/1000,wheelGap:Math.round(wheelGap*1000)/1000,status:local,scoreGap:Number.isFinite(scoreGap)?Math.round(scoreGap*100)/100:null,
   historyTop3Association:riderHistory?{n:riderHistory.n,top3:riderHistory.top3}:null,
   measuredEx:exRisk?{chigiri:exRisk.leader&&{n:exRisk.leader.opportunities,events:exRisk.leader.events},chigirarare:exRisk.follower&&{n:exRisk.follower.opportunities,events:exRisk.follower.events},source:'WINTICKET EX category'}:null,
   basis:exRisk?'直前の選手のちぎり率と本人のちぎられ率（EX実測、縮小補正）':riderHistory?'本人の過去着順と個別脚力。追走離れの実測率ではない':'競走得点・瞬発力・直前の選手の脚。追走離れの実測率ではない'};
}
const api={profile,history,value};
if(typeof module!=='undefined')module.exports=api;
root.BAxisFollow=api;
})(typeof globalThis!=='undefined'?globalThis:this);
