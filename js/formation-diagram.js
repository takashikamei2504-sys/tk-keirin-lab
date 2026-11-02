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
 const tags=new Map(ids.map(n=>[n,[]])),events=[];let outside=[],inside=null,encounter=null,outsideGroups=[];
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
  const claimed=new Set();
  outsideGroups=outside.map(head=>{
   const g=t.outside_groups?.find(g=>g.head===head),members=g?.members||[head];
   if(members[0]!==head||new Set(members).size!==members.length||members.length>1&&t.connected?.[head]===false)throw Error('外のラインの先頭・追走順が一致しません');
   const line=race.lineup.find(l=>l.includes(head)),at=line.indexOf(head);
   for(const [i,no] of members.entries()){
    if(!by.has(no)||claimed.has(no)||no===inside||i>0&&(t.connected?.[no]!==true||no===t.leader||no===t.defender||no===t.seat||line[at+i]!==no))throw Error('外のラインに追走できない選手が含まれています');
    claimed.add(no);if(i>0)tag(no,'追走','role');
   }
   return {head,members:[...members]};
  });
  outside=[...claimed];
  if(stage===1){tag(t.starter,'S取り','key');tag(t.front,'前受け','key');event('start',t.starter,'S取り',{target:t.starter!==t.front?t.front:null,result:t.starter!==t.front?'先頭を迎え入れる':'前受け'});}
  if(stage===2){
   if(t.attacker){tag(t.attacker,t.tactic==='kamashi'?'カマシ':'上昇・抑え');event('red-attack',t.attacker,t.tactic==='kamashi'?'カマシ':'上昇・抑え',{target:t.front,side:'outside',result:t.outcome==='attacker-takes'?'主導権を奪う':'前受けが守る'});}
   if(t.redThird){tag(t.redThird,'攻防利用の上昇');event('red-counter',t.redThird,'攻防を利用して位置を上げる',{target:t.redThirdAhead,side:'outside',result:'先行争いとは別のラインを越える'});}
   if(t.stand==='resist'){tag(t.front,'突っ張り');event('resist',t.front,'突っ張り',{target:t.attacker,side:'inside'});}
   if(t.stand==='yield'){tag(t.front,'引き');event('yield',t.front,'出させて引く',{target:t.attacker});}
   tag(t.leader,'主導権','key');
   if(t.encounter)encounter={attacker:t.encounter.outside,front:t.encounter.front,attack:t.encounter.tactic==='kamashi'?'カマシ':'上昇・抑え',response:t.encounter.stand==='resist'?'突っ張り':'出させて引く',leader:t.encounter.leader,attackLine:t.encounter.attack_line||[t.encounter.outside],frontLine:t.encounter.front_line||[t.encounter.front]};
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
 // Draw explicit tactical relationships; columns are schematic engagement anchors,
 // not a new rank, measured wheel overlap, or a simulation of rider movement.
 const baseRiders=riders.filter(r=>r.lane==='queue'),outerBands=Math.min(inside?1:2,outsideGroups.length),baseRow=outerBands+1;
 const bands=[...Array.from({length:outerBands},(_,i)=>({row:i+1,label:outerBands===2?(i===0?'外②':'外①'):'外',kind:'outside'})),{row:baseRow,label:outerBands||inside?'前団':'列',kind:'queue'},...(inside?[{row:baseRow+1,label:'内',kind:'inside'}]:[])];
 const queueCol=new Map(baseRiders.map((r,i)=>[r.no,i])),occupied=new Set(),placed=new Map();
 const nearestColumn=no=>{const preceding=baseRiders.filter(r=>r.position<=order.indexOf(no)+1);return queueCol.get(preceding.at(-1)?.no)??0;};
 for(const r of baseRiders){const column=queueCol.get(r.no);occupied.add(baseRow+':'+column);placed.set(r.no,{no:r.no,row:baseRow,column:column+1,target:null,relation:'order'});}
 for(const [i,g] of outsideGroups.entries()){
  const head=riders.find(r=>r.no===g.head),row=outerBands===2?(i===0?2:1):1,stopped=head.statuses.some(x=>x.kind==='stopped');
  const target=stopped?null:stage===5&&head.no===t?.cornerRider?t.defender||t.leader:t?.leader;
  let column=stopped?nearestColumn(head.no)+1:queueCol.get(target)??nearestColumn(head.no);
  while(g.members.some((n,j)=>occupied.has(row+':'+(column+j))))column++;
  g.members.forEach((no,j)=>{occupied.add(row+':'+(column+j));placed.set(no,{no,row,column:column+j+1,head:g.head,target:j?g.members[j-1]:target,relation:j?'follow':stopped?'stopped':target?'challenge':'outside'});});
 }
 if(inside){const column=nearestColumn(inside);placed.set(inside,{no:inside,row:baseRow+1,column:column+1,target:null,relation:'inside'});}
 const nodes=riders.map(r=>placed.get(r.no));
 const board={bands,nodes,columns:Math.max(1,...nodes.map(n=>n.column)),overlap:!!outerBands||!!inside};
 const connections=[];
 for(let i=0;i<riders.length-1;i++){
  const a=riders[i],b=riders[i+1];
  const sameTravellingGroup=a.lane!=='outside'||outsideGroups.some(g=>g.members.includes(a.no)&&g.members.includes(b.no));
  const originalFollowing=a.team.id===b.team.id&&b.team.place===a.team.place+1&&sameTravellingGroup;
  connections.push({from:a.no,to:b.no,type:originalFollowing&&b.connected&&a.lane===b.lane?'line':originalFollowing&&b.separated?'gap':'order'});
 }
 // Keep the travelling group visibly connected even when an individual
 // attack advanced in the engine's flat order while its following state held.
 for(const g of outsideGroups)for(let i=0;i<g.members.length-1;i++){
  const from=g.members[i],to=g.members[i+1],existing=connections.findIndex(c=>c.from===from);
  if(existing>=0)connections.splice(existing,1);
  connections.push({from,to,type:'line'});
 }
 let finish=null;
 if(stage===6){
  const podium=t?.finish_order||order.slice(0,3),from=t?.finish_from||previous?.order;
  if(podium.length!==3||podium.some((n,i)=>n!==order[i]))throw Error('モデル図の着順がこの展開の決着と一致しません');
  finish={podium:podium.map((no,i)=>{const passed=from?from.slice(0,from.indexOf(no)).filter(n=>order.indexOf(n)>i):[];return {...riders.find(x=>x.no===no),statuses:passed.length?[{text:t?.defender===no&&t.defense==='vertical'?'縦踏み':t?.innerRider===no?t.innerMode==='split'?'中割り':'イン突き':'直線の追込み',kind:'action'}]:[],place:i+1,from:from?.includes(no)?from.indexOf(no)+1:null,passed};}),from:from?[...from]:null};
 }
 return {stage,phase:scene.phase,shape:scene.shape,order,riders,connections,events,outside,outsideGroups,inside,encounter,finish,board,hasState:!!t};
}
function render(model,{storyId=''}={}){
 const chip=(r,extra='')=>`<div class="formation-rider ${r.separated?'is-separated':''}" data-no="${r.no}" data-position="${r.position}" data-lane="${r.lane}" data-status="${esc(r.statuses.map(x=>x.text).join('|'))}" style="--line-color:${r.team.color}" aria-label="${esc(r.no+'番 '+r.name+'、'+r.position+'番目、ライン'+r.team.id+'、'+r.statuses.map(x=>x.text).join('、'))}"><span class="formation-team">${r.team.id}</span><span class="formation-number car-${r.no}">${r.no}</span><span class="formation-chip-name" title="${esc(r.name)}">${esc(r.label)}</span>${extra}${r.statuses.slice(0,2).map(x=>`<span class="formation-state state-${x.kind}">${esc(x.text)}</span>`).join('')}</div>`;
 const events=model.events.filter(e=>e.type!=='start'||e.target).map(e=>{
  const actor=model.riders.find(r=>r.no===e.actor),target=model.riders.find(r=>r.no===e.target);
  const arrow=({block:'↗',inside:'↖',gap:'⋯',yield:'↘',resist:'↔',start:'←'})[e.type]||'←';
  return `<li class="formation-event event-${e.type}" data-actor="${e.actor}" ${e.target?`data-target="${e.target}"`:''}><span aria-hidden="true">${arrow}</span> <strong>${e.actor} ${esc(actor.label)}</strong> ${esc(e.label)}${target?` <span class="event-target">${e.type==='block'?'→ ':e.type==='start'?'→ ':''}${e.target} ${esc(target.label)}</span>`:''}${e.result?`<small>${esc(e.result)}</small>`:''}</li>`;
 }).join('');
 let body='';
 if(model.encounter){const e=model.encounter,short=n=>esc(model.riders.find(x=>x.no===n).label),line=ns=>`<span class="encounter-line">${ns.map(n=>`<span class="formation-number car-${n}" title="${short(n)}">${n}</span>`).join('<span class="encounter-link">─</span>')}</span>`;
  body=`<div class="formation-encounter" aria-label="赤板の攻防"><strong>赤板の攻防</strong><div><span>外から</span><b class="encounter-rider">${line(e.attackLine)}</b><em>← ${esc(e.attack)}</em></div><div><span>前受け</span><b class="encounter-rider">${line(e.frontLine)}</b><em>${e.response==='突っ張り'?'↔':'↘'} ${esc(e.response)}</em></div><small>${e.leader} ${short(e.leader)}が主導権</small></div><div class="formation-result-label">この局面後の並び</div>`;
 }
 if(model.finish){
  body=`<div class="formation-podium">${model.finish.podium.map(r=>`<div class="finish-place" data-place="${r.place}" data-finish-no="${r.no}"><span class="finish-rank">${r.place}着</span>${chip(r)}<span class="finish-from">${r.from?'4角 '+r.from+'番目 → '+r.place+'着':''}</span></div>`).join('')}</div>`;
  const passing=model.finish.podium.filter(r=>r.passed.length);
  body+=passing.length?`<ul class="formation-passes">${passing.map(r=>`<li data-passer="${r.no}"><strong>${r.no} ${esc(r.label)}</strong> <span aria-hidden="true">←</span> ${r.passed.map(n=>{const other=model.riders.find(x=>x.no===n);return esc(n+' '+other.label);}).join('・')}を交わす</li>`).join('')}</ul>`:'<p class="formation-hold">前の位置を保ってゴール</p>';
 }else{
  const board=model.board;
  body+=`<div class="formation-board-label">${board.overlap?'攻防の位置関係':'左が先頭・右が後方'}</div><div class="formation-track${board.overlap?' has-overlap':''}" style="--cars:${board.columns};--bands:${board.bands.length}" data-bands="${board.bands.length}" aria-label="${board.overlap?'前団と仕掛ける選手の位置関係（模式図）':'左が先頭、右が後方'}">${board.bands.map(b=>`<span class="formation-lane-label lane-${b.kind}" style="grid-row:${b.row}" data-board-row="${b.row}">${b.label}</span>`).join('')}${model.riders.map(r=>{
   const node=board.nodes.find(n=>n.no===r.no),link=model.connections.find(l=>l.from===r.no),next=board.nodes.find(n=>n.no===link?.to);
   const badge=r.statuses.some(x=>x.text==='S取り')?'S':r.statuses.some(x=>x.kind==='gap')?'離':r.statuses.some(x=>x.kind==='stopped')?'止':r.statuses.some(x=>x.text==='ブロック')?'↗':r.statuses.some(x=>x.text==='縦踏み')?'←':r.lane==='outside'&&node.relation!=='follow'?'←':r.lane==='inside'?'↖':'';
   const joined=next&&next.row===node.row&&next.column===node.column+1&&link.type!=='order';
   return `<div class="formation-slot" style="grid-column:${node.column+1};grid-row:${node.row}" data-rank="${r.position}" data-board-row="${node.row}" data-board-column="${node.column}" data-engagement-target="${node.target||''}" data-relation="${node.relation}">${chip(r)}${badge?`<span class="formation-motion">${badge}</span>`:''}${joined?`<span class="formation-link link-${link.type}" aria-hidden="true">${link.type==='line'?'━':'⋯'}</span>`:''}</div>`;
  }).join('')}</div><div class="formation-roster" aria-label="車番と選手名">${model.riders.map(r=>`<span class="formation-roster-item"><span class="formation-number car-${r.no}">${r.no}</span><span class="formation-name">${esc(r.label)}<small class="formation-roster-team">${r.team.id}</small></span></span>`).join('')}</div>`;

 }
 return `<figure class="formation-diagram" data-diagram-stage="${model.stage}" data-story-id="${esc(storyId)}" data-engine-order="${esc(JSON.stringify(model.order))}" aria-label="${esc(model.phase+'の展開モデル図')}"><figcaption><span>${model.finish?'ゴール順':'← 進行方向'}</span><span>${esc(model.shape)}</span></figcaption>${body}${events?`<ul class="formation-events" aria-label="この局面の動き">${events}</ul>`:''}${model.stage===1?'<div class="formation-key">同じ英字・下線＝元のライン ／ S＝S取り・離＝追走離れ</div>':''}</figure>`;
}
const api={project,render};if(typeof module!=='undefined')module.exports=api;root.FormationDiagram=api;
})(typeof globalThis!=='undefined'?globalThis:this);
