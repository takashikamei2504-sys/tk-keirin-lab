/* Weight sensitivity on fixed, already audited candidates; no race simulation. */
(function(root){'use strict';
function review(main,candidates,weights){
 const keys=Object.keys(weights),score=(s,w)=>keys.reduce((n,k)=>n+s.axes[k]*w[k],0),thresholds=[],scenarios=[];
 for(const axis of keys){
  for(const s of candidates.filter(s=>s.id!==main.id)){
   const delta=main.axes[axis]-s.axes[axis],other=keys.filter(k=>k!==axis).reduce((n,k)=>n+(main.axes[k]-s.axes[k])*weights[k],0);
   if(Math.abs(delta)<1e-10)continue;const boundary=-other/delta;if(boundary<0||!Number.isFinite(boundary))continue;
   thresholds.push({axis,current_weight:weights[axis],boundary,change:Math.abs(boundary-weights[axis]),rival:s.id,pair:s.finish.pair,direction:delta>0?'below':'above',scope:'他の重みを固定した2候補間の同点境界。全候補の首位交代を保証しない。'});
  }
  for(const factor of [.5,1.5]){const adjusted={...weights,[axis]:weights[axis]*factor},ranked=candidates.map(s=>({id:s.id,pair:s.finish.pair,score:score(s,adjusted)})).sort((a,b)=>Math.abs(b.score-a.score)<1e-10?a.id-b.id:b.score-a.score);scenarios.push({axis,factor,weight:adjusted[axis],winner:ranked[0].id,pair:ranked[0].pair,main_retained:ranked[0].id===main.id,gap:ranked.length>1?ranked[0].score-ranked[1].score:null});}
 }
 thresholds.sort((a,b)=>a.change-b.change||a.rival-b.rival);
 return {scope:'生成済みの整合性検査済み候補を固定し、判断軸の重みだけを変更。選手特性の変更や未探索展開の再計算ではない。確率ではない。',thresholds,scenarios,changed:scenarios.filter(s=>!s.main_retained).length};
}
const api={review};if(typeof module!=='undefined')module.exports=api;root.LineSensitivity=api;
})(typeof globalThis!=='undefined'?globalThis:this);
