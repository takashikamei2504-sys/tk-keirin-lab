/* Independent line-first hypothesis search. No legacy decision module is imported. */
(function(root){'use strict';
const Provenance=typeof module!=='undefined'?require('../model-provenance.js'):root.ModelProvenance;
const Input=typeof module!=='undefined'?require('./input.js'):root.LineInput;
const Build=typeof module!=='undefined'?require('./build.js'):root.LineBuild;
const VERSION='LAB_LINE_ENGINE_V1.0.0',PHASES=['周回・初手の並び','赤板〜打鐘','最終ホーム','最終バック','最終3〜4コーナー','直線・ゴール'];
const AXES={rationality:'戦術的合理性',feasibility:'成立可能性',evidence:'実績の裏付け',interaction:'他ラインとの相互作用',robustness:'頑健性・反証'};
const TACTICS={press:'押さえ先行',cut:'斬って中団',resist:'突っ張り',yield:'出させて脚を温存',kamashi:'カマシ',long:'早めの捲り',short:'短い捲り',wait:'待機・位置維持',use:'別線の仕掛けを利用',seat:'番手飛びつき',block:'牽制',vertical:'縦に踏む'};
const copy=x=>JSON.parse(JSON.stringify(x)),clamp=x=>Math.max(0,Math.min(1,x));
function structure(r){
 const lines=r.lineup.map((members,i)=>({id:String.fromCharCode(65+i),members:[...members],head:members[0],length:members.length}));
 const active=lines.filter(l=>r.riders.find(x=>x.no===l.head).style!=='追'),aggressive=active.filter(l=>r.riders.find(x=>x.no===l.head).style==='逃');
 return {lines,kind:active.length===1?'先行一車':lines.filter(l=>l.length>1).length===2?'二分戦':lines.filter(l=>l.length>1).length===3?'三分戦':'細切れ',active:active.map(l=>l.id),aggressive:aggressive.map(l=>l.id),solos:lines.filter(l=>l.length===1).map(l=>l.id),patterns:lines.map(l=>({line:l.id,roles:l.members.map((no,i)=>({no,role:i===0?'先頭':i===1?'番手':i===2?'3番手':`${i+1}番手`})),options:l.length===1?['wait','use','seat',...(active.includes(l)?['short']:[])]:active.includes(l)?['press','cut','resist','yield','kamashi','long','short','wait','use']:['wait','use']}))};
}
function build(raw,packs={},options={}){
 const input=Input.prepare(raw,packs,options.asOf??Date.now()),r=input.race,topology=structure(r),by=Object.fromEntries(r.riders.map(x=>[x.no,x])),lines=Object.fromEntries(topology.lines.map(l=>[l.id,l])),width=options.width??96;
 if(!Number.isInteger(width)||width<16||width>256)throw Error('探索幅は16〜256');
 if(r.race_material.lineup_conflicts?.length)throw Error('並びの矛盾を解消してください：'+r.race_material.lineup_conflicts.join('。'));
 let serial=0;const rejected=[],counts={generated:0,pruned:0},idOf=no=>topology.lines.find(l=>l.members.includes(no)).id;
 let evaluationStage=0;
 const legacyPhases=['並び確認・S取り','赤板周回～打鐘','最終ホーム','最終バック','最終3～4コーナー','最後の直線'];
 const mapping={initiative:['resist'],front:['front'],sprint:['makuri','kamashi'],endurance:['long_makuri'],track:['track'],block:['block'],position:['seat','inside'],finish:['finish','outer']};
 const contextual=(no,key)=>{
  const base=input.features[no][key],role=lines[idOf(no)].head===no?'leader':'follower';
  const rows=input.records.filter(e=>e.no===no&&e.numeric&&(mapping[key]||[]).includes(e.trait)&&Object.keys(e.context||{}).length&&Object.entries(e.context).every(([k,v])=>({phase:legacyPhases[evaluationStage],role})[k]===v));
  const sources=[...new Map(rows.map(e=>[e.url,e])).values()];
  if(!sources.length)return base;
  const weight=sources.reduce((a,e)=>a+e.confidence,0);return {...base,value:(base.value*2+sources.reduce((a,e)=>a+e.value*e.confidence,0))/(2+weight),basis:base.basis+'＋局面・役割が一致する本文観察',sources:[...base.sources,...sources]};
 };
 const f=(no,key)=>contextual(no,key).value;
 const ev=(no,key)=>({no,key,...contextual(no,key)});
 const power=id=>f(lines[id].head,'ability'),initiative=id=>f(lines[id].head,'initiative'),who=id=>`${id}ライン（${lines[id].members.join('-')}）`;
 // Burden is an ordinal search cost, never metres, watts, elapsed seconds, or a measured fatigue value.
 function initial(front){return {id:++serial,order:[front,...topology.lines.map(l=>l.id).filter(id=>id!==front)],outside:null,burden:Object.fromEntries(topology.lines.map(l=>[l.id,0])),detached:[],switches:{},events:[],scenes:[],terms:[],assumptions:[],failures:[],used:[],attacks:[],defense:null};}
 function term(s,axis,value,reason,features=[]){s.terms.push({phase:s.scenes.length,axis,value,reason,features});}
 function event(s,actor,action,reason,extra={}){s.events.push({actor,action,reason,...extra});}
 function snap(s,stage){
  const groups=s.order.map(id=>({id,members:lines[id].members.filter(n=>!s.detached.includes(n)&&!Object.hasOwn(s.switches,n)),lane:0}));
  if(s.outside){const g=groups.find(x=>x.id===s.outside.id);g.lane=1;g.anchor=s.outside.anchor;g.progress=s.outside.progress;for(const id of s.outside.followers||[]){const following=groups.find(x=>x.id===id);following.lane=1;following.anchor=g.anchor;following.offset=g.members.length;following.progress='別線の仕掛けに乗る';}}
  for(const [no,target]of Object.entries(s.switches)){const g=groups.find(x=>x.id===target);g.members.push(Number(no));}
  const solo=s.detached.map(n=>({id:`離${n}`,members:[n],lane:2,detached:true}));
  const inside=groups.filter(g=>!g.lane),lead=inside[0]?.id;
  s.scenes.push({phase:PHASES[stage],groups:[...groups,...solo],order:groups.filter(g=>!g.lane).flatMap(g=>g.members).concat(groups.filter(g=>g.lane).flatMap(g=>g.members),s.detached),control:lead,middle:inside[1]?.id||null,rear:inside.at(-1)?.id||null,outside:copy(s.outside),burden:copy(s.burden),contest:s.contest?copy(s.contest):null,connected:Object.fromEntries(r.riders.map(x=>[x.no,!s.detached.includes(x.no)])),events:s.events.splice(0),opportunities:s.order.filter(id=>id!==lead).map(id=>({line:id,options:s.outside?.id===id?['捲り継続','不発から立て直し']:['待機','位置取り','反撃']}))});
 }
 function move(s,id,to){s.order=s.order.filter(x=>x!==id);s.order.splice(to,0,id);}
 function attack(s,id,kind){
  const index=s.order.indexOf(id),lead=s.order.find(x=>x!==s.outside?.id),h=lines[id].head;
  if(index===0||s.outside)return [];
  const needs=kind==='long'?'endurance':'sprint',support=f(h,needs),supportSources=input.features[h][needs].sources;
  if(kind==='long'&&support<.5){rejected.push({phase:s.scenes.length,line:id,tactic:kind,reason:'長く踏む裏付けが弱く、後方からの早い捲りを本線候補に置けない',features:[ev(h,'endurance')]});return [];}
  const t=copy(s);t.id=++serial;t.used.push(id);t.attacks.push({id,kind,from:index,phase:s.scenes.length});t.burden[id]+=kind==='long'?2:1;
  t.outside={id,anchor:lead,progress:index===1?'前団に接近':'中団外から進行',kind,from:index};
  event(t,id,kind,`${who(id)}は${index===1?'中団':'後方'}で待ち続けると進路を失うため${TACTICS[kind]}。${who(lead)}はペースを上げて迎え撃つ`);
  t.burden[lead]++;
  for(const other of s.order.filter(x=>x!==id&&x!==lead))event(t,other,'wait',`${who(other)}は外の仕掛けと前団の踏み直しを見て、無理な並走を増やさず次の進路を待つ`);
  term(t,'rationality',.2+support*.5,`${who(id)}の仕掛け機会と${needs==='endurance'?'長く踏む':'加速'}傾向を照合`,[ev(h,needs)]);
  term(t,'feasibility',power(id)-power(lead)*.5-index*.09,`出発位置${index+1}番目・相手の得点差・負担を評価`,[ev(h,'ability'),ev(lines[lead].head,'ability')]);
  term(t,'interaction',.35,`${who(lead)}は踏み直し、残りのラインは仕掛けの後ろを利用するか位置維持を選ぶ`);
  term(t,'evidence',supportSources.length?.35:0,supportSources.length?'公開本文の根拠を採用':'仕掛けの直接本文根拠は不足',[ev(h,needs)]);
  // A distant late attack must not jump directly to the lead.
  if(kind==='short'&&index>1){term(t,'robustness',-.5,'後方から短い捲りは前団まで届く前提が厳しい');t.assumptions.push(`${who(id)}の短い捲りは届かず外で止まる可能性`);}
  const following=s.order[index+1];
  if(following){const ride=copy(t);ride.id=++serial;ride.outside.followers=[following];ride.burden[following]++;
   ride.events=ride.events.filter(e=>e.actor!==following);event(ride,following,'use',`${who(following)}は直前の${who(id)}の仕掛けに乗り、自ら外を踏み上げる負担を抑えて位置を上げる`);
   term(ride,'rationality',f(lines[following].head,'position')*.45,'別線利用は仕掛けの直後にいるラインだけに許す',[ev(lines[following].head,'position')]);
   ride.assumptions.push(`${who(following)}は利用する別線の仕掛けが止まれば一緒に進路を失う`);return [t,ride];
  }return [t];
 }
 function early(s){
  const result=[],front=s.order[0];
  // Holding the front is a real option; every other line has an explicit reason to wait.
  const hold=copy(s);term(hold,'rationality',initiative(front),`${who(front)}が主導権を得る。別線は主導権争いの消耗を避けて仕掛けを遅らせる`,[ev(lines[front].head,'initiative')]);
  for(const id of hold.order)event(hold,id,'wait',id===front?'前受けを維持し相手の上昇に備える':'先に踏む利益よりも脚の温存を重視する');
  term(hold,'robustness',-Math.max(0,...s.order.slice(1).map(id=>initiative(id)-initiative(front))),'積極型を無条件に待たせる仮説には不利な評価');result.push(hold);
  for(const id of s.order.slice(1).filter(id=>topology.active.includes(id))){for(const intent of ['press','cut'])for(const response of ['resist','yield']){
   const t=copy(s);t.id=++serial;t.used.push(id);t.burden[id]++;const fh=lines[front].head,ah=lines[id].head;
   event(t,id,intent,`${who(id)}は後方回避と${intent==='cut'?'中団確保':'主導権確保'}のため上昇する`);
   if(response==='resist'){
    t.burden[front]+=2;t.burden[id]++;move(t,id,Math.min(1,t.order.length-1));
    event(t,front,response,`${who(front)}は${lines[front].length}車の連係と前受けを生かし、引いて後方になる不利益を避ける`);
    term(t,'feasibility',initiative(front)+power(front)-power(id)-.5,'突っ張りは前受け・先行傾向・相手との力差で評価',[ev(fh,'initiative'),ev(fh,'ability'),ev(ah,'ability')]);
    term(t,'robustness',-.25,'突っ張り合いで双方が脚を使い、第三ラインに機会');
   }else{
    move(t,id,0);event(t,front,response,`${who(front)}は無理に踏み合わず${who(id)}を出し、その後ろで再反撃の機会を待つ`);
    term(t,'rationality',.4+f(fh,'sprint')*.3-initiative(front)*.3,'出させた後の位置確保と捲り返す余地を比較',[ev(fh,'sprint'),ev(fh,'initiative')]);
    term(t,'feasibility',.35+initiative(id)*.4,'上昇側の先行傾向が主導権取得を支える',[ev(ah,'initiative')]);
   }
   term(t,'rationality',intent==='cut'?f(ah,'position'):.25+initiative(id)*.4+Math.min(.2,(lines[id].length-1)*.08),`${who(id)}の${TACTICS[intent]}をライン長と行動傾向で比較`,[ev(ah,intent==='cut'?'position':'initiative')]);
   term(t,'interaction',.6,'上昇・前受けの応答・残るラインの位置を一つの遷移で更新');
   term(t,'evidence',input.features[ah].initiative.sources.length?.3:0,'主導権を求める実戦傾向の裏付け',[ev(ah,'initiative')]);
   for(const other of s.order.filter(x=>x!==id&&x!==front))event(t,other,'wait','前の攻防を見て、中団へ入る機会と脚を温存する利益を残す');
   if(intent==='cut'&&response==='yield')t.pendingCut=id;
   if(intent==='cut')t.assumptions.push(`${who(id)}は斬った後、別線を受け入れ中団へ移る必要がある`);
   result.push(t);
  }}return result;
 }
 function launch(s,stage){
  if(s.pendingCut){
   const release=s.order.filter(id=>id!==s.pendingCut&&topology.active.includes(id)).map(id=>{
    const t=copy(s);t.id=++serial;const cut=t.pendingCut;t.pendingCut=null;move(t,id,0);t.burden[id]++;
    event(t,id,'press',`${who(id)}は斬ったラインを出させたままにせず、前へ出て主導権を取る`);
    event(t,cut,'yield',`${who(cut)}は斬る目的どおり別線を受け入れ、中団で次の仕掛けに備える`);
    term(t,'rationality',initiative(id), '斬りの後の主導権引受けを実際の積極型で成立させる',[ev(lines[id].head,'initiative')]);return t;
   });
   for(const t of release)for(const other of t.order.filter(id=>!t.events.some(e=>e.actor===id)))event(t,other,'wait','前の入れ替わりに対して中団を維持し、先行争いの負担を避ける');
   if(!release.length)rejected.push({line:s.pendingCut,reason:'斬った後に主導権を引き受ける別線がいない'});return release;
  }
  const result=[];
  const waiting=copy(s),lead=s.order[0];waiting.burden[lead]++;
  for(const id of s.order)event(waiting,id,'wait',id===lead?'先頭でペースを作り、踏み直せる余力を残す':s.outside?.id===id?'前局面の外進行を継続する':'前団の踏み合いを避けて位置と余力を維持する');
  term(waiting,'rationality',.25,'待機は無駄な踏み合いを避ける選択');
  const unused=s.order.slice(1).filter(id=>topology.active.includes(id)&&!s.used.includes(id));
  term(waiting,'robustness',-Math.max(0,...unused.map(id=>power(id)+f(lines[id].head,'sprint')-power(lead)-.35)),'未仕掛けの有力別線を止め続ける仮説を反証',[ev(lines[lead].head,'ability')]);
  result.push(waiting);
  if(s.outside)return result;
  for(const id of unused){for(const kind of stage===2?['kamashi','long']:['short'])result.push(...attack(s,id,kind));}
  return result;
 }
 function defense(s){
  if(!s.outside){const t=copy(s);event(t,t.order[0],'vertical','外からの攻撃がないので牽制のため横に動く理由がなく、直線へ向け縦に踏む');term(t,'robustness',.05,'余分なブロック成功を前提としない');return [t];}
  const attackId=s.outside.id,defId=s.outside.anchor,att=lines[attackId],def=lines[defId],follower=def.members[1],index=s.outside.from;
  const attackStrength=power(attackId)+f(att.head,s.outside.kind==='long'?'endurance':'sprint')*.45-s.burden[attackId]*.07;
  const defenseStrength=power(defId)+s.burden[defId]*-.06+(follower?f(follower,'block')*.25:0);
  const result=[];
  for(const action of follower?['block','vertical']:['vertical'])for(const outcome of ['success','partial','failure']){
   const t=copy(s);t.id=++serial;const riding=[...(s.outside.followers||[])];t.defense={actor:follower||def.head,action,outcome,attacker:att.head};
   const margin=attackStrength-defenseStrength;
   // Rear short attacks have not reached the leading pair at the corner.
   if(outcome==='failure'&&s.outside.kind==='short'&&index>1){rejected.push({line:attackId,tactic:'short',reason:'後方から最終バックで動いた短い捲りを一局面で先頭へ移す根拠がない'});continue;}
   if(action==='vertical'&&outcome==='partial')continue;
   if(outcome==='failure'){
    move(t,attackId,0);t.outside=null;term(t,'feasibility',margin,'攻撃側が前団を越える条件を比較',[ev(att.head,'ability'),ev(att.head,'sprint'),ev(def.head,'ability')]);
    event(t,attackId,'pass',`${who(attackId)}は前局面からの外進行を継続し${who(defId)}を乗り越える`);
    if(action==='block')t.burden[defId]++;
   }else if(outcome==='success'){
    t.outside=null;move(t,attackId,Math.min(2,t.order.length-1));t.burden[attackId]++;
    term(t,'feasibility',-margin+(action==='block'&&follower?f(follower,'block')*.25:0),'攻撃側が止まる条件・守備側の牽制傾向を照合',follower?[ev(follower,'block'),ev(att.head,'sprint')]:[ev(att.head,'sprint')]);
    event(t,attackId,'stalled',`${who(attackId)}は外で前団を越せず、後退して立て直す`);
   }else{
    t.outside.progress='前団外で並走継続';t.burden[attackId]++;t.burden[defId]++;
    term(t,'feasibility',.25-Math.abs(margin),'牽制は攻撃を遅らせるが、完全には止めない');
    event(t,attackId,'parallel','牽制で進行を遅らせられるが、外並走を続ける');
   }
   for(const ridingId of riding){if(outcome==='failure')move(t,ridingId,1);else if(outcome==='success')move(t,ridingId,Math.min(t.order.indexOf(attackId)+1,t.order.length-1));event(t,ridingId,'use',outcome==='failure'?'利用した別線が前団を越えたため、その後ろで位置を上げる':outcome==='partial'?'利用した別線とともに外で並走し、自身も脚を使う':'利用した別線が止まり、その後ろから立て直す');t.burden[ridingId]++;}
   event(t,defId,action,action==='block'?`${follower}番は先行を残すため牽制。${outcome==='success'?'止める':outcome==='partial'?'遅らせるが外並走が残る':'止め切れず自身も脚を使う'}`:'番手は横への対応で進路を失うより、縦に踏んで着を確保する');
   term(t,'rationality',action==='block'&&follower?f(follower,'block')-.2:.25,'牽制の採用理由と縦踏みの利益を比較',follower?[ev(follower,'block')]:[]);
   term(t,'interaction',.5,'攻撃側の進行と守備側の負担を同時更新');
   term(t,'robustness',outcome==='failure'&&margin<0?-.6:outcome==='success'&&margin>0?-.5:0,'相手より不利な条件での都合のよい成功には不利な評価');
   t.assumptions.push(`${who(attackId)}の仕掛けに対し${who(defId)}が${action==='block'?'牽制':'縦踏み'}し、${outcome==='success'?'前団を守る':outcome==='partial'?'並走が残る':'乗り越えられる'}こと`);
   result.push(t);
  }return result;
 }
 function followers(s){
  const result=[s];
  for(const id of s.order){const line=lines[id];if(line.length===1)continue;const second=line.members[1];
   if(!s.detached.includes(second)&&f(second,'track')<.5&&s.attacks.some(a=>a.id===id)){
    const t=copy(s);t.id=++serial;t.detached.push(...line.members.slice(1));event(t,id,'detach',`${second}番以降は加速で追走が離れ、元の連結を失う`);term(t,'feasibility',.5-f(second,'track'),'仕掛け時の追走負担と本文根拠を照合',[ev(second,'track')]);result.push(t);
   }
  }
  // Single riders can follow a launched line without teleporting across the field.
  for(const solo of topology.solos){const at=s.order.indexOf(solo),target=s.attacks.at(-1)?.id;if(!target||at<0||s.order.indexOf(target)>at||s.detached.length===0)continue;
   const vacancy=s.detached.find(n=>idOf(n)===target);if(!vacancy)continue;
   const t=copy(s);t.id=++serial;t.switches[lines[solo].head]=target;event(t,solo,'seat',`${who(solo)}は近くの仕掛けラインの追走離れで空いた位置へ切り替える`);term(t,'feasibility',f(lines[solo].head,'position')-.2,'元の位置と空席の発生を条件に切替',[ev(lines[solo].head,'position')]);result.push(t);
  }return result;
 }
 
 function soloResponse(s){
  const result=[s],lead=s.order.find(id=>id!==s.outside?.id),vacancy=s.detached.some(n=>idOf(n)===lead);
  for(const solo of topology.solos){const no=lines[solo].head,at=s.order.indexOf(solo);if(at!==1||s.switches[no]||s.detached.includes(no))continue;
   if(!vacancy&&f(no,'position')<.55)continue;
   for(const outcome of vacancy?['seat']:['seat_partial','seat_fail']){
    const t=copy(s);t.id=++serial;
    if(outcome==='seat')t.switches[no]=lead;
    if(outcome==='seat_partial'){
     // A contested second position does not erase the incumbent; retain parallel lanes.
     t.contest={challenger:no,incumbent:lines[lead].members[1],target:lead};t.burden[solo]++;t.burden[lead]++;
    }
    if(outcome==='seat_fail')t.burden[solo]++;
    event(t,solo,outcome,vacancy?'単騎は直前の追走離れによる空席を利用し番手へ切り替える':outcome==='seat_partial'?'単騎は番手を求めるが守備側も譲らず、競りが続く':'番手確保はできず、3番手以降で立て直し直線を待つ');
    term(t,'rationality',f(no,'position')-.2,'単騎の現在位置から空席・競りと失敗負担を比較',[ev(no,'position')]);
    term(t,'robustness',vacancy?.1:-.35,'番手を無条件には奪えない');result.push(t);
   }
  }return result;
 }

 function subtotal(s,axis){const ts=s.terms.filter(t=>t.axis===axis);return ts.length?ts.reduce((a,t)=>a+t.value,0)/ts.length:0;}
 // Cheap exploration rank only. Final selection below chooses a race-dependent axis.
 function rank(s){return Object.keys(AXES).reduce((a,k)=>a+subtotal(s,k),0);}
 function trim(states){counts.generated+=states.length;const buckets=new Map();
  for(const s of states){const key=[s.order.join(''),s.outside?.id,s.outside?.kind,s.defense?.action,s.defense?.outcome,s.detached.join(),JSON.stringify(s.switches),s.attacks.map(a=>a.kind).join()].join('|');if(!buckets.has(key)||rank(s)>rank(buckets.get(key)))buckets.set(key,s);}
  const sorted=[...buckets.values()].sort((a,b)=>rank(b)-rank(a)||a.id-b.id),selected=[],families=new Set();
  // Retain distinct strategic families before filling the beam.
  for(const s of sorted){const family=[s.scenes[0]?.control,s.attacks[0]?.id,s.attacks[0]?.kind,s.defense?.action,s.defense?.outcome].join('|');if(!families.has(family)&&selected.length<width){families.add(family);selected.push(s);}}
  for(const s of sorted)if(selected.length<width&&!selected.includes(s))selected.push(s);counts.pruned+=states.length-selected.length;return selected;
 }
 let states=topology.lines.map(line=>{const s=initial(line.id);term(s,'rationality',f(line.head,'front'),`${who(line.id)}が初手の前を求めるS傾向`,[ev(line.head,'front')]);event(s,line.id,'front','ライン単位で初手の前受けを選ぶ。他線は後方から上昇する選択肢を残す');snap(s,0);return s;});
 evaluationStage=1;states=trim(states.flatMap(early));states.forEach(s=>snap(s,1));
 evaluationStage=2;states=trim(states.flatMap(s=>launch(s,2)).flatMap(followers));states.forEach(s=>snap(s,2));
 // Existing external attacks first continue; new attacks at the back cannot jump to the front.
 evaluationStage=3;states=trim(states.flatMap(s=>launch(s,3)));states.forEach(s=>snap(s,3));
 evaluationStage=4;states=trim(states.flatMap(defense).flatMap(followers).flatMap(s=>soloResponse(s)));states.forEach(s=>snap(s,4));
 evaluationStage=5;const finishHypotheses=[];
 for(const state of states){
  const lead=state.order.find(id=>id!==state.outside?.id),line=lines[lead],head=line.head,second=state.scenes[4].groups.find(g=>g.id===lead)?.members[1],third=state.scenes[4].groups.find(g=>g.id===lead)?.members[2],burden=state.burden[lead];
  const leaderStrength=f(head,'ability')*.5+f(head,'endurance')*.5-burden*.07;
  const followStrength=second&&!state.detached.includes(second)?f(second,'ability')*.45+f(second,'finish')*.4+f(second,'track')*.15-(state.defense?.actor===second&&state.defense.action==='block'?.12:0):-1;
  const pairs=[{pair:[head,second],mode:'先行残り',margin:leaderStrength-followStrength},{pair:[second,head],mode:'番手差し',margin:followStrength-leaderStrength}].filter(x=>x.pair.every(Boolean)&&!state.detached.includes(x.pair[0]));
  if(!second){const next=state.order.filter(id=>id!==lead&&id!==state.outside?.id)[0];pairs.push({pair:[head,lines[next].head],mode:'単騎先頭からの直線',margin:leaderStrength-.4});}
  if(state.outside&&!(state.outside.kind==='short'&&state.outside.from>1)){const attacker=lines[state.outside.id].head;pairs.push({pair:[attacker,head],mode:'外並走から直線で捲り切り',margin:f(attacker,'sprint')*.5+f(attacker,'ability')*.5-state.burden[state.outside.id]*.08-leaderStrength});}
  if(third&&!state.detached.includes(third)&&f(third,'finish')>f(head,'finish')+.15)pairs.push({pair:[third,second||head],mode:'3番手の直線勝負',margin:f(third,'finish')-leaderStrength-.2});
  for(const fin of pairs){const s=copy(state);s.id=++serial;
   term(s,'feasibility',fin.margin,`${fin.mode}は先行負担・残る脚・番手の追走／牽制負担を独立比較`,[ev(head,'endurance'),...(second?[ev(second,'finish'),ev(second,'track')]:[])]);
   const corner=s.scenes[4],position=n=>corner.order.indexOf(n),available=corner.order.filter(n=>!fin.pair.includes(n));
   const thirdRank=available.map(no=>({no,comparison:f(no,'finish')+f(no,'ability')*.3-position(no)*.07-(s.detached.includes(no)?.35:0),reason:`${no}番は4角${position(no)+1}番手から直線。${idOf(no)===lead?'同ラインの連結を保つ':'前団との位置差と伸びを比較'}。`,features:[ev(no,'finish'),ev(no,'ability')]})).sort((a,b)=>b.comparison-a.comparison);
   const best=thirdRank[0],thirds=thirdRank.filter(x=>x.comparison>=best.comparison-.13&&position(x.no)<=4&&!s.detached.includes(x.no)).slice(0,3);
   if(!thirds.length)thirds.push(best);
   s.finish={...fin,leaderStrength,followStrength,thirds};
   s.assumptions.push(`${fin.mode}には先行の負担と番手の余力の大小関係が維持されることが必要`);
   event(s,lead,'finish',`${fin.mode}を主要決着とし、${fin.pair.join('→')}。主導権の負担と番手の余力を比べた結論`);
   snap(s,5);s.scenes[5].order=[...fin.pair,thirds[0].no,...corner.order.filter(n=>!fin.pair.includes(n)&&n!==thirds[0].no)];
   s.scenes[5].finish_order=true;finishHypotheses.push(s);
  }
 }
 if(!finishHypotheses.length)throw Error('成立する決着候補がありません');
 // Hard audit precedes any weighted comparison.
 const valid=finishHypotheses.filter(s=>{
  const ids=r.riders.map(x=>x.no).sort().join();
  const ok=s.scenes.every(scene=>scene.order.slice().sort().join()===ids)&&s.scenes.length===6;
  if(!ok)rejected.push({id:s.id,reason:'全員の位置が連続状態に存在しないため棄却'});return ok;
 });
 if(!valid.length)throw Error('局面状態の整合性を満たす候補なし');
 const spreads=Object.keys(AXES).map(axis=>{const values=valid.map(s=>subtotal(s,axis));return {axis,spread:Math.max(...values)-Math.min(...values)};}).sort((a,b)=>b.spread-a.spread);
 const axis=spreads[0].axis,dominance=spreads[0].spread;
 const weight=Object.fromEntries(Object.keys(AXES).map(k=>[k,k===axis?2:1]));
 const rated=valid.map(s=>({...s,axes:Object.fromEntries(Object.keys(AXES).map(k=>[k,subtotal(s,k)])),score:Object.keys(AXES).reduce((a,k)=>a+subtotal(s,k)*weight[k],0)})).sort((a,b)=>b.score-a.score||a.id-b.id);
 const main=rated[0],rival=rated.find(s=>s.order[0]!==main.order[0]||s.finish.pair.join()!==main.finish.pair.join()||s.attacks[0]?.id!==main.attacks[0]?.id)||rated[1];
 const drivers=main.terms.filter(t=>t.axis===axis).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)),gap=rival?main.score-rival.score:null;
 const tickets=main.finish.thirds.map(x=>({trio:[...main.finish.pair,x.no],key:[...main.finish.pair,x.no].join('-'),hypothesis:main.id,group:'main',reason:x.reason}));
 if(rival&&gap<.45){const x=rival.finish.thirds[0],trio=[...rival.finish.pair,x.no];if(!tickets.some(t=>t.key===trio.join('-')))tickets.push({trio,key:trio.join('-'),hypothesis:rival.id,group:'alternative',reason:`${rival.finish.mode}の独立仮説：`+rival.scenes.flatMap(x=>x.events).filter(e=>['pass','resist','yield','long','kamashi','short'].includes(e.action)).map(e=>e.reason).join('。')});}
 const reversalChanges=rival?Object.keys(AXES).map(k=>({axis:k,label:AXES[k],main:main.axes[k],rival:rival.axes[k],weighted_difference:(main.axes[k]-rival.axes[k])*weight[k]})).sort((a,b)=>Math.abs(b.weighted_difference)-Math.abs(a.weighted_difference)):[];
 const decision={axis,label:AXES[axis],reason:`候補間で「${AXES[axis]}」の評価差${dominance.toFixed(3)}が最も大きく、同軸を優先。固定のレース別重みを置かず、この入力の候補比較から抽出。`,spreads,weights:weight,drivers,gap,confidence:gap!==null&&gap<.2?'拮抗':'相対的に優位',selection_reason:drivers.map(t=>t.reason).slice(0,3).join('。'),reversal:rival?{rival:rival.id,condition:`本線を支える「${reversalChanges[0].label}」の優位が崩れ、対抗の条件が上回る場合。${rival.scenes.flatMap(s=>s.events).find(e=>['long','kamashi','short','press'].includes(e.action))?.reason||rival.finish.mode}。対抗との差${gap.toFixed(3)}は校正確率ではない。`,changes:reversalChanges,terms:rival.terms.filter(t=>t.axis===axis)}:null};
 const diverse=[],seenFamilies=new Set();for(const s of rated.filter(s=>s.id!==main.id)){const family=[s.attacks.at(-1)?.kind,s.defense?.action,s.defense?.outcome,s.detached.length>0,!!s.contest].join('|');if(!seenFamilies.has(family)){diverse.push(s);seenFamilies.add(family);}}
 const alternatives=diverse.slice(0,12).map(s=>({...s,not_selected:`比較評価${s.score.toFixed(3)}。本線${main.score.toFixed(3)}との差は${(main.score-s.score).toFixed(3)}。${AXES[axis]}：${s.axes[axis].toFixed(3)}／本線${main.axes[axis].toFixed(3)}`}));
 return {schema:'tk-keirin-line/v1',version:VERSION,generated_at:new Date().toISOString(),mode:!options.replay&&Date.parse(input.as_of)<Date.parse(input.cutoff)?'pre-race':'historical-replay',provenance:{input_sha256:Provenance.sha256(input),model:Build,input_as_of:input.as_of,cutoff:input.cutoff},input,topology,main,decision,rival,alternatives,candidate_evaluations:rated.map(s=>({id:s.id,score:s.score,axes:s.axes,pair:s.finish.pair,mode:s.finish.mode,attacks:s.attacks,defense:s.defense,detached:s.detached,contest:s.contest||null})),tickets,compressed:compress(tickets),rejected,uncertainty:input.uncertainty,search:{...counts,width,retained:rated.length,method:'ライン戦術別の候補保持→局面更新→矛盾棄却→動的判断軸比較',limited:true},value_assessment:'オッズ未評価。比較評価は確率・成功率・購入価値ではない。'};
}
function compress(tickets){const groups=new Map();for(const t of tickets){const k=t.trio.slice(0,2).join('-');if(!groups.has(k))groups.set(k,new Set());groups.get(k).add(t.trio[2]);}return [...groups].map(([k,thirds])=>({text:k+'-'+[...thirds].sort((a,b)=>a-b).join(''),count:thirds.size}));}
const api={VERSION,PHASES,AXES,TACTICS,structure,build,compress};if(typeof module!=='undefined')module.exports=api;root.LineEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this);
