/* LINE state projection and causal gates. No legacy prediction logic. */
(function(root){'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
function active(s){return [s.outside,s.secondary].filter(Boolean);}
function members(s,id,lines){
 const base=lines[id].members.filter(n=>!s.detached.includes(n)&&!Object.hasOwn(s.switches,n)&&s.innerRoute?.no!==n);
 const incoming=Object.entries(s.switches).filter(([,target])=>target===id).map(([n])=>Number(n));
 const rear=new Set(s.rearJoins||[]),front=incoming.filter(n=>!rear.has(n)),tail=incoming.filter(n=>rear.has(n));
 return base.length?[base[0],...front,...base.slice(1),...tail]:[...front,...tail];
}
const riderCount=lines=>Object.values(lines).reduce((n,l)=>n+l.members.length,0);
function project(s,lines){
 const attacks=active(s),groups=s.order.map(id=>({id,members:members(s,id,lines),lane:0}));
 attacks.forEach((a,i)=>{const g=groups.find(g=>g.id===a.id);g.lane=i+1;g.anchor=a.anchor;g.progress=a.progress;g.attack=true;g.offset=0;
  for(const id of a.followers||[]){const tail=groups.find(g=>g.id===id);if(!tail||active(s).some(x=>x.id===id))continue;tail.lane=i+1;tail.anchor=a.anchor;tail.offset=g.members.length;tail.progress='別線利用';tail.attack=true;}
 });
 if(s.contest){const g=groups.find(g=>g.members.includes(s.contest.challenger));if(g){g.members=g.members.filter(n=>n!==s.contest.challenger);groups.push({id:'競'+s.contest.challenger,origin:g.id,members:[s.contest.challenger],lane:1,anchor:s.contest.target,progress:'番手競り継続',contested:true});}}
 if(s.innerRoute)groups.push({id:'内'+s.innerRoute.no,origin:Object.values(lines).find(l=>l.members.includes(s.innerRoute.no)).id,members:[s.innerRoute.no],lane:2,anchor:s.innerRoute.target,progress:'牽制で開いた内進路',inside:true});
 const detached=s.detached.map((no,i)=>({id:'離'+no,origin:Object.values(lines).find(l=>l.members.includes(no)).id,members:[no],lane:2,detached:true,offset:i,progress:'追走離れ'}));
 const control=groups.find(g=>g.lane===0&&g.members.length)?.id,positions={},starts={};let cursor=0;
 for(const g of groups.filter(g=>g.lane===0)){starts[g.id]=cursor;for(const no of g.members)positions[no]={lane:0,ordinal:cursor++,band:'inner'};}
 for(const g of groups.filter(g=>g.lane>0))g.members.forEach((no,i)=>{positions[no]={lane:g.lane,ordinal:(starts[g.anchor]??0)+1+(g.offset||0)+i,band:g.inside?'inside':g.contested?'contest':'outside',anchor:g.anchor};});
 for(const g of detached)positions[g.members[0]]={lane:2,ordinal:riderCount(lines)-1,band:'detached'};
 return {positions,groups:[...groups,...detached],order:groups.filter(g=>g.lane===0).flatMap(g=>g.members).concat(groups.filter(g=>g.lane>0).flatMap(g=>g.members),s.detached),control};
}
function audit(s,r,lines){
 const failures=[],ids=r.riders.map(x=>x.no).sort((a,b)=>a-b).join();
 if(s.scenes.length!==6)failures.push('6局面が揃わない');
 for(let i=0;i<s.scenes.length;i++){
  const scene=s.scenes[i];if(scene.order.slice().sort((a,b)=>a-b).join()!==ids)failures.push(i+'局面の重複・選手消失');
  if(i<5&&scene.groups.flatMap(g=>g.members).slice().sort((a,b)=>a-b).join()!==ids)failures.push(i+'局面の図と全選手状態が不一致');
  if(i>0&&i<5&&scene.control!==s.scenes[i-1].control&&!scene.events.some(e=>['press','pass','resist','yield','counter_pass'].includes(e.action)))failures.push(i+'局面の主導権変化に説明がない');
 }
 if(s.pendingCut)failures.push('斬りの後の主導権引受けが未解決');
 const winner=s.finish.pair[0],corner=s.scenes[4];
 if(s.detached.includes(winner))failures.push('追走離れ後の回復なしに1着');
 if(corner.order.indexOf(winner)>4&&!['内進路からの直線','不発後の立て直し','外並走から直線で捲り切り'].includes(s.finish.mode))failures.push('4角後方から進路・進行説明なく1着');
 for(const a of active(s))if(a.kind==='short'&&a.from>1&&winner===lines[a.id].head)failures.push('後方の遅い仕掛けが一局面で先頭');
 if(s.innerRoute&&(!s.defenses?.some(d=>d.action==='block')&&!s.defense?.action?.includes('block')))failures.push('内進路を作った牽制がない');
 if(s.contest?.outcome==='unresolved'&&s.finish.pair[0]===s.contest.challenger)failures.push('競りの解決なしに挑戦者が1着');
 if(s.attacks.some(a=>a.from===0))failures.push('先頭からの捲り');
 return {passed:!failures.length,failures,checks:['選手の保存','図と状態の一致','主導権変化の因果','仕掛け距離と局面','競りと内進路の成立条件','追走離れと回復']};
}
const api={clone,active,members,project,audit};if(typeof module!=='undefined')module.exports=api;root.LineState=api;
})(typeof globalThis!=='undefined'?globalThis:this);
