/* Fixed-budget tactical diversity. Retained mass is never an outcome probability. */
(function(root){'use strict';
function family(s){const opening=s.attacker?(s.stand==='resist'&&s.leader===s.front?'突っ張り':s.tactic==='kamashi'?'カマシ':'抑え'):'前受け維持';const move=s.backRider?'バック反撃':s.homeRider?'ホーム捲り':s.redThird?'第三線利用':'先行継続';return `${opening}:${s.attacker||s.front}|${move}:${s.backRider||s.homeRider||s.redThird||s.leader}|${s.defense||'未決'}|追走切れ:${Object.values(s.connected||{}).filter(v=>v===false).length}|内:${s.openInside?'open':'closed'}:${s.innerRider||''}`;}
function key(s){return JSON.stringify([s.stage,s.order,s.energy,s.connected,s.outside,s.starter,s.front,s.attacker,s.tactic,s.stand,s.outcome,s.redThird,s.redThirdAhead,s.homeRider,s.homeResult,s.backRider,s.backResult,s.gap,s.seat,s.defender,s.cornerRider,s.defense,s.blockResult,s.innerRider,s.openInside,s.analysisCost,s.auditFailures,s.reactionLog,s.recovery,s.frontResponse]);}
const compare=(a,b)=>a.auditFailures-b.auditFailures||a.analysisCost-b.analysisCost||b.mass-a.mass||key(a).localeCompare(key(b));
function retain(all,width,phase){
 const unique=new Map();let merged=0;for(const s of all){const id=key(s),old=unique.get(id);if(old){old.mass+=s.mass;merged++;}else unique.set(id,{...s});}
 const ordered=[...unique.values()].sort(compare),groups=new Map();for(const s of ordered){const f=family(s);if(!groups.has(f))groups.set(f,[]);groups.get(f).push(s);}
 const queues=[...groups.values()],kept=[];let round=0;while(kept.length<width){let progress=false;for(const q of queues){if(q[round]){kept.push(q[round]);progress=true;if(kept.length===width)break;}}if(!progress)break;round++;}
 const before={},after={};for(const s of ordered)before[family(s)]=(before[family(s)]||0)+1;for(const s of kept)after[family(s)]=(after[family(s)]||0)+1;
 const mass=all.reduce((n,s)=>n+s.mass,0),retainedMass=kept.reduce((n,s)=>n+s.mass,0),droppedMass=Math.max(0,mass-retainedMass);
 return {kept,droppedMass,trace:{phase,generated:all.length,unique:ordered.length,merged,retained:kept.length,families_before:before,families_after:after,pruned_mass:droppedMass,measure:'relative hypothesis mass; not probability'}};
}
function assess(s,audit){
 const scenes=s.scenes,issues=[...audit.violations],leaders=scenes.map(x=>x.order[0]);
 for(let i=1;i<scenes.length;i++){const a=scenes[i-1],b=scenes[i];for(const n of Object.keys(a.tactical?.connected||{}))if(a.tactical.connected[n]===false&&b.tactical?.connected[n]===true)issues.push({phase:b.phase,objection:n+'番の追走復帰に成立過程がない'});}
 const components={personality:1/(1+s.analysisCost),counterplay:1/(1+audit.regret),control:1-Math.min(.8,Math.max(0,leaders.length-new Set(leaders).size-2)*.035),energy:1-Math.min(1,(s.energy[s.leader]||0)),following:s.gap==='holds'?1:s.seat?.8:.55,finish_access:s.order.indexOf(s.leader)===0?1:0};
 const score=components.personality*.30+components.counterplay*.30+components.control*.10+components.energy*.10+components.following*.10+components.finish_access*.10;
 return {passed:issues.length===0,score,components,objections:issues,family:family(s),checks:['仕掛け/待機の効用差','前団と第三線の反撃','局面間の連結','主導権と消耗','最終コーナーの到達位置']};
}
const api={family,key,retain,assess};if(typeof module!=='undefined')module.exports=api;root.TacticalSearch=api;
})(typeof globalThis!=='undefined'?globalThis:this);
