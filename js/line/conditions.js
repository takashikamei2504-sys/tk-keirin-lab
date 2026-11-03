/* Small, explicitly uncalibrated condition adjustments; missing values stay missing. */
(function(root){'use strict';
function evaluate(conditions={}){
 const latest=new Map();for(const o of (conditions.observations||[]).slice().sort((a,b)=>Date.parse(a.collected_at)-Date.parse(b.collected_at)))latest.set(o.kind,o);
 const observations=[...latest.values()],used=[],ignored=[];let lead_cost=0,outer_cost=0,finish_allowance=0;
 for(const o of observations){
  if(o.kind==='bank'&&Number.isFinite(o.lap_length_m)&&o.lap_length_m>=250&&o.lap_length_m<=600&&Number.isFinite(o.straight_length_m)&&o.straight_length_m>=20&&o.straight_length_m<=90){
   finish_allowance=Math.max(-.025,Math.min(.025,(o.straight_length_m-50)*.001));used.push({...o,adjustment:'直線長に応じた直線比較の小幅補正',value:finish_allowance});
  }else if(o.kind==='wind'&&Number.isFinite(o.speed_mps)&&o.speed_mps>=0&&o.speed_mps<=30&&['headwind','tailwind','crosswind'].includes(o.home_direction)){
   const amount=Math.min(.06,o.speed_mps*.008);if(o.home_direction==='headwind')lead_cost=amount;if(o.home_direction==='tailwind')lead_cost=-amount*.35;if(o.home_direction==='crosswind')outer_cost=amount;
   used.push({...o,adjustment:'向かい風の先行負担／横風の外進行負担を条件比較',value:o.home_direction==='crosswind'?outer_cost:lead_cost});
  }else ignored.push({kind:o.kind,source_url:o.source_url,reason:'単位・値・ホームとの方向関係を確定できない'});
 }
 const features=used.map(o=>({no:'条件',key:o.kind,value:o.value,basis:o.adjustment+(o.kind==='bank'?`：周長${o.lap_length_m}m、直線${o.straight_length_m}m`:`：観測風速${o.speed_mps}m/s、ホーム${o.home_direction}`),sources:[{url:o.source_url,published_at:o.published_at,collected_at:o.collected_at,kind:'verified_condition',excerpt:'発走前に取得した環境観測（補正規則は未校正）'}]}));
 return {lead_cost,outer_cost,finish_allowance,used,ignored,features,scope:'観測条件の比較調整。実測速度・成功率への変換ではない。'};
}
const api={evaluate};if(typeof module!=='undefined')module.exports=api;root.LineConditions=api;
})(typeof globalThis!=='undefined'?globalThis:this);
