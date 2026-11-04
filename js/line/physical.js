/* Conservative phase/relative-movement gates. No fabricated seconds, watts or measured speeds. */
(function(root){'use strict';
const LIMITS=Object.freeze({1:6.1,2:3.0,3:2.8,4:2.3});
const round=n=>Math.round(n*1000)/1000;
function movement(step){
 const from=step.before?.indexOf(step.actor),to=step.after?.indexOf(step.actor);
 if(from===undefined||to===undefined||from<0||to<0)return Infinity;
 const gain=Math.max(0,from-to);
 return round(.50+gain*.36+(step.action==='press'?.12:0)+(step.action==='position'?.12:0));
}
function phase(scene,previous,index){
 const impossible=[],uncertainty=[],events=scene.events||[];
 if(index===1){
  const steps=scene.positioning_steps||[];
  let units=0;
  for(let i=0;i<steps.length;i++){
   const st=steps[i],before=st.before||[],after=st.after||[];
   if(before.length!==after.length||new Set(before).size!==before.length||new Set(after).size!==after.length||
    before.slice().sort().join()!==after.slice().sort().join())impossible.push('赤板の位置取りでラインの重複・消失');
   if(i&&steps[i-1].after.join('|')!==before.join('|'))impossible.push('赤板の行動順序に連続性がない');
   const m=movement(st);if(!Number.isFinite(m))impossible.push('移動元と移動先が確認できない');else units+=m;
  }
  if(steps.length&&units>LIMITS[1]+1e-8)impossible.push('赤板から打鐘の連続上昇が局面内の保守的な移動容量を超える');
  if(steps.length)uncertainty.push('赤板の行動間隔・外並走の実測速度は未取得');
  return {phase:index,required_units:round(units),available_units:LIMITS[1],impossible,uncertainty,measured:false};
 }
 if(index>0&&index<5){
  const last=previous?.outside;
  for(const e of events){
   if(e.action==='pass_middle'){
    const prior=previous?.outside;
    if(!prior||prior.id!==e.actor||prior.from<2||!(prior.started<index))impossible.push('前局面からの外進行なしに中団を追い越す');
    else uncertainty.push('中団追い越しの速度差・間隔は未計測。直前局面からの外進行のみ確認');
   }
   if(e.action==='pass'&&(!last||last.id!==e.actor)&&!previous?.secondary?.id)uncertainty.push('前団を抜くための外進行の詳細時刻は未計測');
   if(e.action==='draft'&&!events.some(x=>x.action==='pass_middle'))uncertainty.push('別線追走には実際の速度・車間・風圧条件の確認が必要');
  }
 }
 return {phase:index,required_units:null,available_units:LIMITS[index]??null,impossible,uncertainty,measured:false};
}
function middlePassOpportunity(state,attacker,defender,features){
 const x=state.outside;
 if(!x||x.id!==attacker||x.from!==2||!(x.started<state.scenes.length)||state.order[2]!==attacker||state.order[1]!==defender)return {allowed:false,reason:'中団を交わす前から継続した外進行と正しい順序がない',status:'impossible'};
 const f=(id,trait)=>Math.max(0,Math.min(1,features(id,trait)||0));
 const spent=state.effort?.[attacker]?.spent||0;
 // Relative progress envelope: weak evidence means no automatic pass, not a measured probability.
 const potential=f(attacker,'sprint')*.43+f(attacker,'ability')*.30-f(defender,'sprint')*.17-spent*.07+.12;
 if(potential<.17)return {allowed:false,reason:'後方ラインの相対的な加速能力と既消費量では中団を交わす根拠が乏しい',status:'not_supported',potential:round(potential)};
 return {allowed:true,status:'conditional',potential:round(potential),reason:'継続した外進行と相対的加速余地を確認。ただし実測速度・間隔による成立証明ではない'};
}
function audit(state,topology,features){
 const failures=[],warnings=[],phases=[];
 for(let i=0;i<Math.min(5,state.scenes.length);i++){
  const cur=phase(state.scenes[i],state.scenes[i-1],i);
  phases.push(cur);failures.push(...cur.impossible);warnings.push(...cur.uncertainty);
 }
 for(const line of topology.lines){
  const id=line.id,e=state.effort?.[id],head=line.head,endurance=features?.[head]?.endurance?.value;
  if(!e)continue;
  const capacity=3.2+Math.max(0,Math.min(1,Number.isFinite(endurance)?endurance:.5))*1.5;
  if(e.spent>capacity+.001)failures.push(id+'ラインの累積努力が相対的な耐久容量を超える');
  if(e.spent>capacity*.83)warnings.push(id+'ラインは反復加速による余力低下に注意');
  if(e.actions?.some(x=>x.cost<0))failures.push(id+'ラインの負荷が負値になっている');
 }
 return {passed:failures.length===0,failures:[...new Set(failures)],warnings:[...new Set(warnings)],phases,measured:false,scope:'正規化した局面容量・相対加速・累積努力の整合性検査。秒数や実測速度ではない'};
}
const api={LIMITS,movement,phase,middlePassOpportunity,audit};
if(typeof module!=='undefined')module.exports=api;
root.LinePhysical=api;
})(typeof globalThis!=='undefined'?globalThis:this);
