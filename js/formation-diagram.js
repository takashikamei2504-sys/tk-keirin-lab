/* Pure projection of an engine scene. No scenario selection or movement simulation. */
(function(root){'use strict';
const SCHEMA='tk-keirin-scene-state/v1',COLORS=['#80caff','#e3adff','#94d6b1','#e6c673','#ffab9c','#b1baff'];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean=s=>String(s||'').replace(/[\s\u3000]/g,'');
function project(scene,race,previous=null){
 const by=new Map(race.riders.map(r=>[r.no,r])),ids=[...by.keys()],order=[...scene.order],stage=scene.stage;
 if(order.length!==ids.length||new Set(order).size!==ids.length||!order.every(n=>by.has(n)))throw Error('モデル図の隊列が出走者と一致しません');
 const t=scene.tactical?.schema===SCHEMA?scene.tactical:null,old=previous?.tactical?.schema===SCHEMA?previous.tactical:null;
 const team=new Map();race.lineup.forEach((line,i)=>line.forEach((no,j)=>team.set(no,{id:String.fromCharCode(65+i),color:COLORS[i%COLORS.length],place:j})));
 const name=no=>by.get(no)?.name||'',before=t?.finish_from||previous?.order||null;
 const tags=new Map(ids.map(n=>[n,[]])),events=[];let outside=[],inside=null,encounter=null;
 const tag=(no,text,kind='action')=>{if(by.has(no)&&!tags.get(no).some(x=>x.text===text))tags.get(no).push({text,kind});};
 function event(type,actor,label,{target=null,result='',side=null}={}){
  if(!by.has(actor))return;
  events.push({type,actor,target:by.has(target)?target:null,label,result,side,
   from:before?.includes(actor)?before.indexOf(actor)+1:null,to:order.indexOf(actor)+1});
 }
 if(t){
  if(old&&ids.some(n=>old.connected?.[n]===false&&t.connected?.[n]===true))throw Error('追走離れからの復帰を説明する状態がありません');
  if(stage<6&&t.leader&&t.leader!==order[0])throw Error('先頭と主導権の状態が一致しません');
  if((t.outside||[]).some(n=>!by.has(n)))throw Error('外の選手が出走者に含まれていません');
  if(stage===5&&t.blockResult==='stopped'&&t.cornerRider&&t.corner_order_before&&order.indexOf(t.cornerRider)<t.corner_order_before.indexOf(t.cornerRider))throw Error('ブロック成功と前進が矛盾しています');
  if(stage===5&&t.innerRider&&!t.openInside)throw Error('内の進路を示す状態がありません');
  outside=stage>=3&&stage<=5?(t.outside||[]).filter(n=>by.has(n)):[];
  inside=stage===5&&t.openInside&&by.has(t.innerRider)?t.innerRider:null;
  if(inside)outside=outside.filter(n=>n!==inside);
  if(stage===1){tag(t.starter,'S取り','key');tag(t.front,'前受け','key');event('start',t.starter,'S取り',{target:t.starter!==t.front?t.front:null,result:t.starter!==t.front?'先頭を迎え入れる':'前受け'});}
  if(stage===2){
   if(t.attacker){tag(t.attacker,t.tactic==='kamashi'?'カマシ':'上昇・抑え');event('red-attack',t.attacker,t.tactic==='kamashi'?'カマシ':'上昇・抑え',{target:t.front,side:'outside',result:t.outcome==='attacker-takes'?'主導権を奪う':'前受けが守る'});}
   if(t.stand==='resist'){tag(t.front,'突っ張り');event('resist',t.front,'突っ張り',{target:t.attacker,side:'inside'});}
   if(t.stand==='yield'){tag(t.front,'引き');event('yield',t.front,'出させて引く',{target:t.attacker});}
   tag(t.leader,'主導権','key');
   if(t.encounter)encounter={attacker:t.encounter.outside,front:t.encounter.front,attack:t.encounter.tactic==='kamashi'?'カマシ':'上昇・抑え',response:t.encounter.stand==='resist'?'突っ張り':'出させて引く',leader:t.encounter.leader};
  }
  if(stage<=2){if(order[1]===t.control_line?.[1])tag(order[1],'番手','role');if(order[2]===t.control_line?.[2])tag(order[2],'3番手','role');}
  if(stage===3&&t.homeRider){tag(t.homeRider,'ロング捲り');event('home-attack',t.homeRider,'ロング捲り',{side:'outside',result:t.homeResult==='takes'?'前団をとらえる':'外並走'});}
  if(stage===4&&t.backRider){tag(t.backRider,t.homeRider===t.backRider?'捲り継続':'バック捲り');event('back-attack',t.backRider,t.homeRider===t.backRider?'仕掛け継続':'バックから反撃',{side:'outside',result:t.backResult==='takes'?'主導権を取る':'外並走'});}
  if(stage>=3&&stage<=5){
   for(const no of ids)if(t.connected?.[no]===false){tag(no,no===t.leader?'離れ→再自力':'追走離れ','gap');}
   const follower=t.control_line?.[1],third=t.control_line?.[2];
   const defender=t.defender||(stage===3&&t.gap==='holds'?follower:null);
   if(defender)tag(defender,t.seat===defender?'番手はまり':'番手','role');
   if(!t.seat&&t.gap==='holds'&&third&&t.connected?.[third]!==false)tag(third,'3番手','role');
   tag(t.leader,'主導権','key');
   if(t.seat)event('seat',t.seat,'番手はまり',{target:t.leader});
   const separated=ids.filter(n=>t.connected?.[n]===false&&(!old||old.connected?.[n]!==false));
   for(const no of separated)event('gap',no,'追走離れ');
  }
  if(stage===5){
   if(t.cornerRider){const label=t.cornerOrigin==='recover'?'再自力':t.cornerOrigin==='outer'?'大外捲り':'捲り';tag(t.cornerRider,label);event('corner-attack',t.cornerRider,label,{side:'outside',result:t.blockResult==='stopped'?'止められる・前進なし':'外から迫る'});}
   if(t.defense==='block'&&t.defender&&t.cornerRider){tag(t.defender,'ブロック');event('block',t.defender,'ブロック',{target:t.cornerRider,side:'outside',result:t.blockResult==='stopped'?'成功・相手を止める':'止め切れない'});if(t.blockResult==='stopped')tag(t.cornerRider,'止まる','stopped');}
   if(t.defense==='vertical'&&t.defender){tag(t.defender,'縦踏み');event('vertical',t.defender,'縦踏み',{target:t.leader});}
   if(inside){tag(inside,t.innerMode==='split'?'中割り':'イン突き');event('inside',inside,t.innerMode==='split'?'中割り':'イン突き',{side:'inside'});}
  }
 }
 const riders=order.map((no,i)=>{
  const r=by.get(no),rawFamily=r.family||r.meta?.family||String(r.name).trim().split(/[\s\u3000]+/).slice(0,-1).join('');
  // Never guess a Japanese surname by taking the first two characters.
  const label=rawFamily&&clean(r.name).startsWith(clean(rawFamily))?clean(rawFamily):clean(r.name);
  const statuses=tags.get(no),priority={stopped:0,gap:1,action:2,key:3,role:4};
  statuses.sort((a,b)=>priority[a.kind]-priority[b.kind]);
  return {no,name:r.name,label,position:i+1,team:team.get(no),lane:inside===no?'inside':outside.includes(no)?'outside':'queue',statuses,
   separated:t?.connected?.[no]===false,connected:t?.connected?.[no]!==false};
 });
 const connections=[];
 for(let i=0;i<riders.length-1;i++){
  const a=riders[i],b=riders[i+1];
  const originalFollowing=a.team.id===b.team.id&&b.team.place===a.team.place+1;
  connections.push({from:a.no,to:b.no,type:originalFollowing&&b.connected&&a.lane===b.lane?'line':originalFollowing&&b.separated?'gap':'order'});
 }
 let finish=null;
 if(stage===6){
  const podium=t?.finish_order||order.slice(0,3),from=t?.finish_from||previous?.order;
  if(podium.length!==3||podium.some((n,i)=>n!==order[i]))throw Error('モデル図の着順がこの展開の決着と一致しません');
  finish={podium:podium.map((no,i)=>{const passed=from?from.slice(0,from.indexOf(no)).filter(n=>order.indexOf(n)>i):[];return {...riders.find(x=>x.no===no),statuses:passed.length?[{text:t?.defender===no&&t.defense==='vertical'?'縦踏み':t?.innerRider===no?t.innerMode==='split'?'中割り':'イン突き':'直線の追込み',kind:'action'}]:[],place:i+1,from:from?.includes(no)?from.indexOf(no)+1:null,passed};}),from:from?[...from]:null};
 }
 return {stage,phase:scene.phase,shape:scene.shape,order,riders,connections,events,outside,inside,encounter,finish,hasState:!!t};
}
function render(model,{storyId=''}={}){
 const chip=(r,extra='')=>`<div class="formation-rider ${r.separated?'is-separated':''}" data-no="${r.no}" data-position="${r.position}" data-lane="${r.lane}" data-status="${esc(r.statuses.map(x=>x.text).join('|'))}" style="--line-color:${r.team.color}" aria-label="${esc(r.no+'番 '+r.name+'、'+r.position+'番目、ライン'+r.team.id+'、'+r.statuses.map(x=>x.text).join('、'))}"><span class="formation-team">${r.team.id}</span><span class="formation-number car-${r.no}">${r.no}</span><span class="formation-name" title="${esc(r.name)}">${esc(r.label)}</span>${extra}${r.statuses.slice(0,2).map(x=>`<span class="formation-state state-${x.kind}">${esc(x.text)}</span>`).join('')}</div>`;
 const events=model.events.filter(e=>e.type!=='start'||e.target).map(e=>{
  const actor=model.riders.find(r=>r.no===e.actor),target=model.riders.find(r=>r.no===e.target);
  const arrow=({block:'↗',inside:'↖',gap:'⋯',yield:'↘',resist:'↔',start:'←'})[e.type]||'←';
  return `<li class="formation-event event-${e.type}" data-actor="${e.actor}" ${e.target?`data-target="${e.target}"`:''}><span aria-hidden="true">${arrow}</span> <strong>${e.actor} ${esc(actor.label)}</strong> ${esc(e.label)}${target?` <span class="event-target">${e.type==='block'?'→ ':e.type==='start'?'→ ':''}${e.target} ${esc(target.label)}</span>`:''}${e.result?`<small>${esc(e.result)}</small>`:''}</li>`;
 }).join('');
 let body='';
 if(model.encounter){const e=model.encounter,short=n=>esc(model.riders.find(x=>x.no===n).label);
  body=`<div class="formation-encounter" aria-label="赤板の攻防"><strong>赤板の攻防</strong><div><span>外から</span><b>${e.attacker} ${short(e.attacker)}</b><em>← ${esc(e.attack)}</em></div><div><span>前受け</span><b>${e.front} ${short(e.front)}</b><em>${e.response==='突っ張り'?'↔':'↘'} ${esc(e.response)}</em></div><small>${e.leader} ${short(e.leader)}が主導権</small></div><div class="formation-result-label">この局面後の並び</div>`;
 }
 if(model.finish){
  body=`<div class="formation-podium">${model.finish.podium.map(r=>`<div class="finish-place" data-place="${r.place}" data-finish-no="${r.no}"><span class="finish-rank">${r.place}着</span>${chip(r)}<span class="finish-from">${r.from?'4角 '+r.from+'番目 → '+r.place+'着':''}</span></div>`).join('')}</div>`;
  const passing=model.finish.podium.filter(r=>r.passed.length);
  body+=passing.length?`<ul class="formation-passes">${passing.map(r=>`<li data-passer="${r.no}"><strong>${r.no} ${esc(r.label)}</strong> <span aria-hidden="true">←</span> ${r.passed.map(n=>{const other=model.riders.find(x=>x.no===n);return esc(n+' '+other.label);}).join('・')}を交わす</li>`).join('')}</ul>`:'<p class="formation-hold">前の位置を保ってゴール</p>';
 }else{
  for(let offset=0;offset<model.riders.length;offset+=3){
   const group=model.riders.slice(offset,offset+3),outer=group.some(r=>r.lane==='outside'),inner=group.some(r=>r.lane==='inside'),base=outer?2:1;
   const lanes=[...(outer?[['outside','外',1]]:[]),['queue',outer||inner?'前団':'列',base],...(inner?[['inside','内',base+1]]:[])];
   body+=`<div class="formation-segment"><div class="formation-range">${offset===0?'先頭から':(offset+1)+'番目から'}${group.length}車</div><div class="formation-grid">${lanes.map(([lane,label,row])=>`<span class="formation-lane-label lane-${lane}" style="grid-row:${row}">${label}</span>`).join('')}${group.map((r,i)=>{
    const row=r.lane==='outside'?1:r.lane==='inside'?base+1:base,link=model.connections.find(l=>l.from===r.no);
    return `<div class="formation-slot" style="grid-column:${i+2};grid-row:${row}" data-rank="${r.position}"><span class="formation-position">${r.position===1?'先頭':r.position+'番目'}</span>${chip(r)}${i<group.length-1?`<span class="formation-link link-${link?.type||'order'}" aria-hidden="true">${link?.type==='line'?'━':link?.type==='gap'?'⋯':'›'}</span>`:''}</div>`;
   }).join('')}</div></div>${offset+3<model.riders.length?'<div class="formation-continuation" aria-hidden="true">↓ 後方へ続く</div>':''}`;
  }
 }
 return `<figure class="formation-diagram" data-diagram-stage="${model.stage}" data-story-id="${esc(storyId)}" data-engine-order="${esc(JSON.stringify(model.order))}" aria-label="${esc(model.phase+'の展開モデル図')}"><figcaption><span>${model.finish?'ゴール順':'← 進行方向'}</span><span>${esc(model.shape)}</span></figcaption>${body}${events?`<ul class="formation-events" aria-label="この局面の動き">${events}</ul>`:''}${model.stage===1?'<div class="formation-key">同じ英字・線色＝同じライン</div>':''}</figure>`;
}
const api={project,render};if(typeof module!=='undefined')module.exports=api;root.FormationDiagram=api;
})(typeof globalThis!=='undefined'?globalThis:this);
