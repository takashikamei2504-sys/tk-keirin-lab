/* B-AXIS conditional B-to-corner interactions. Independent of LAB/LINE prediction engines.
 * Block/detachment evidence is read only from pre-race features and modeled
 * positions; the values here are feasibility/relative support, NOT empirical rates.
 */
(function(root){'use strict';
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const round=v=>Math.round(v*1000)/1000;
function value(input,no,key,fallback=.45){
 const x=input?.features?.[no]?.[key]?.value;
 return Number.isFinite(x)?clamp(x):fallback;
}
function review(input,snap){
 const states=snap.states||[],leader=states.find(x=>x.no===snap.bNo);
 if(!leader)throw Error('B selected rider missing from B state');
 const own=snap.line.join('-');
 const same=s=>s.line.join('-')===own;
 const marker=states.find(s=>s.role==='B番手'&&same(s));
 const attached=Boolean(marker&&marker.gap<=2.25&&marker.track!=='追走離れ気味');
 const defender=attached?marker:null;
 const attackerStates=states.filter(s=>s.attack&&s.reachable&&s.no!==snap.bNo&&s.line.join('-')!==own);
 const attackers=attackerStates.map(att=>{
  const dist=att.gap;
  const threat=clamp(att.speed*.31+att.closing*.30+att.remaining*.22+att.ability*.17);
  const defenderAbility=defender?clamp(value(input,defender.no,'block',.40)*.35+defender.remaining*.23+defender.ability*.19+
     value(input,defender.no,'track',.45)*.14+(1-clamp(defender.gap/3))*.09):null;
  // A genuine block requires the attached B marker, an approaching outside
  // attacker and lateral/time overlap. No positional teleportation.
  const overlap=Boolean(defender&&dist<=3.9&&dist>=.55&&Math.abs(att.gap-defender.gap)<=3.25);
  const blockTension=overlap?round(clamp(.50+(defenderAbility-threat)*.65)):null;
  const follower=states.find(s=>s.line[0]===att.line[0]&&s.lineIndex===att.lineIndex+1);
  const followed=Boolean(follower&&follower.gap-att.gap<=1.45&&follower.track!=='追走離れ気味'&&follower.gap<=4.75);
  const route=dist<=1.75?'Bと並走圏':dist<=2.8?'捲り射程':'追い上げ必要';
  return {no:att.no,gap:round(dist),threat:round(threat),route,blockable:overlap,blockTension,
    defenderNo:defender?.no??null,followed,followerNo:followed?follower.no:null,
    chaseFeasible:dist<=3.9&&att.closing>=.43,
    risk:dist>2.9?'コーナーまでに追撃距離を詰める必要':'コーナーまでの反撃は位置上可能'};
 }).sort((a,b)=>a.gap-b.gap||b.threat-a.threat);
 const detachment=states.filter(s=>s.track==='追走離れ気味').map(s=>({
  no:s.no,relativeGap:round(s.gap),role:s.role,source:'B時点の相対位置・追走指数から導いた仮説（実測ではない）'
 }));
 const abilityRange=attackers.length?round(attackers[0].threat-(defender?value(input,defender.no,'block',.4):0)):null;
 return {version:'b-axis-interaction-v1',selectedB:snap.bNo,
  defender:marker?{no:marker.no,connected:attached,remaining:marker.remaining,gap:marker.gap,blockFeature:value(input,marker.no,'block',.4)}:null,
  attackers,detachment,estimatedPopulationBlockSuccessRate:null,measuredBlockAttempts:0,
  evidenceBasis:'Source-based block attempts are kept in an external observational dataset; this runtime does not treat hypothetical block outcomes as measurements.',
  responseStrength:abilityRange};
}
const api={review,value};if(typeof module!=='undefined')module.exports=api;root.BAxisInteractions=api;
})(typeof globalThis!=='undefined'?globalThis:this);
