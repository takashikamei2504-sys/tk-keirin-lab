/* Independent line-first hypothesis search. No legacy decision module is imported. */
(function(root){'use strict';
const Provenance=typeof module!=='undefined'?require('../model-provenance.js'):root.ModelProvenance;
const Input=typeof module!=='undefined'?require('./input.js'):root.LineInput;
const State=typeof module!=='undefined'?require('./state.js'):root.LineState;
const Interactions=typeof module!=='undefined'?require('./interactions.js'):root.LineInteractions;
const Positioning=typeof module!=='undefined'?require('./positioning.js'):root.LinePositioning;
const Conditions=typeof module!=='undefined'?require('./conditions.js'):root.LineConditions;
const Selection=typeof module!=='undefined'?require('./selection.js'):root.LineSelection;
const Tickets=typeof module!=='undefined'?require('./tickets.js'):root.LineTickets;
const Sensitivity=typeof module!=='undefined'?require('./sensitivity.js'):root.LineSensitivity;
const Build=typeof module!=='undefined'?require('./build.js'):root.LineBuild;
const VERSION='LAB_LINE_ENGINE_V1.3.2',PHASES=['周回・初手の並び','赤板〜打鐘','最終ホーム','最終バック','最終3〜4コーナー','直線・ゴール'];
const AXES={rationality:'戦術的合理性',feasibility:'成立可能性',evidence:'実績の裏付け',interaction:'他ラインとの相互作用',robustness:'頑健性・反証'};
const TACTICS={press:'押さえ先行',cut:'斬って中団',resist:'突っ張り',yield:'出させて脚を温存',withdraw:'引いて立て直す',position:'中団を奪う',kamashi:'カマシ',long:'早めの捲り',short:'短い捲り',wait:'待機・位置維持',use:'別線の仕掛けを利用',seat:'番手飛びつき',block:'牽制',vertical:'縦に踏む',continue:'外進行の継続',counter:'別線の外から反撃',recover:'不発後の立て直し',relaunch:'仕掛け直し',reconnect:'離れから追走回復',inside:'内の進路',seat_won:'番手確保',seat_held:'番手防衛',seat_partial:'番手競り継続'};
const copy=x=>JSON.parse(JSON.stringify(x)),clamp=x=>Math.max(0,Math.min(1,x));
function structure(r,features={}){
 const lines=r.lineup.map((members,i)=>({id:String.fromCharCode(65+i),members:[...members],head:members[0],length:members.length}));
 const active=lines.filter(l=>r.riders.find(x=>x.no===l.head).style!=='追'||(r.race_material?.comments||[]).some(c=>c.rider===r.riders.find(x=>x.no===l.head).name&&/^自力|^前で|^自分で/.test(c.declaration||'')&&!/しない|ません|ではない/.test(c.declaration||''))),aggressive=active.filter(l=>r.riders.find(x=>x.no===l.head).style==='逃'||(features[l.head]?.initiative.value||0)>=.58);
 const lone=active.length===1||aggressive.length===1&&active.filter(l=>!aggressive.includes(l)).every(l=>(features[l.head]?.initiative.value??.5)<.45);
 return {lines,kind:lone?'先行一車':lines.filter(l=>l.length>1).length===2?'二分戦':lines.filter(l=>l.length>1).length===3?'三分戦':'細切れ',multiple_aggressive:aggressive.length>1,multiple_sprinters:active.filter(l=>!aggressive.includes(l)).length>1,active:active.map(l=>l.id),aggressive:aggressive.map(l=>l.id),solos:lines.filter(l=>l.length===1).map(l=>l.id),patterns:lines.map(l=>({line:l.id,roles:l.members.map((no,i)=>({no,role:i===0?'先頭':i===1?'番手':i===2?'3番手':`${i+1}番手`})),options:l.length===1?['wait','use','seat',...(active.includes(l)?['short']:[])]:active.includes(l)?['press','cut','resist','yield','kamashi','long','short','wait','use']:['wait','use']}))};
}

/* A front-receiving line is not automatically the rider who takes S.
 * For solo S-taking, require solo-specific, pre-race evidence rather than
 * treating an S count accumulated in other line configurations as intent.
 */
function frontChoices(r,topology,records=[]){
 const by=new Map(r.riders.map(x=>[x.no,x])),comments=r.race_material?.comments||[];
 const soloReason=no=>{
  const rider=by.get(no),normal=x=>String(x||'').replace(/\s/g,'');
  const stated=comments.some(c=>{
   if(normal(c.rider)!==normal(rider.name)||c.declaration_complete===false)return false;
   const declaration=String(c.declaration||c.excerpt||'');
   return /(?:[ＳS]を?取(?:る|り|って)|[ＳS]を?狙|スタート(?:を)?取|初手.*(?:前受け|先頭)|前受け)/.test(declaration)&&
    !/(?:しない|しません|取らない|狙わない|ではない|かもしれない|できれば)/.test(declaration);
  });
  const observed=records.some(e=>{
   const ctx=e.context||{};
   return e.no===no&&e.numeric&&e.trait==='front'&&e.value>=.7&&
    (ctx.solo===true||ctx.line_size===1||ctx.line_length===1||ctx.role==='solo'||ctx.lineup==='solo');
  });
  return stated?'今回の本人コメントが単騎の前受け意向を明示':observed?'単騎でSを取りに行った条件付き実戦観察あり':null;
 };
 const allSolo=topology.lines.every(l=>l.length===1),choices=[],excluded=[];
 for(const line of topology.lines){
  if(line.length>1){choices.push({line,solo_reason:null});continue;}
  const reason=soloReason(line.head);
  if(reason||allSolo)choices.push({line,solo_reason:reason||(allSolo?'全員単騎のため初手の前受け候補を限定できない':null)});
  else excluded.push({line:line.id,rider:line.head,reason:'単騎の積極的なS取りを支持する発走前の意思・単騎条件の実戦観察がない。過去のS本数だけでは判断しない'});
 }
 return {choices,excluded};
}
function build(raw,packs={},options={}){
 const input=Input.prepare(raw,packs,options.asOf??Date.now()),r=input.race,topology=structure(r,input.features),by=Object.fromEntries(r.riders.map(x=>[x.no,x])),lines=Object.fromEntries(topology.lines.map(l=>[l.id,l])),width=options.width??96;
 const environment=Conditions.evaluate(r.conditions);
 if(!Number.isInteger(width)||width<16||width>256)throw Error('探索幅は16〜256');
 if(r.race_material.lineup_conflicts?.length)throw Error('並びの矛盾を解消してください：'+r.race_material.lineup_conflicts.join('。'));
 let serial=0;const rejected=[],counts={generated:0,pruned:0},idOf=no=>topology.lines.find(l=>l.members.includes(no)).id;
 let evaluationStage=0,evaluationState=null;const setContext=s=>{evaluationState=s;};
 const legacyPhases=['並び確認・S取り','赤板周回～打鐘','最終ホーム','最終バック','最終3～4コーナー','最後の直線'];
 const mapping={withdraw:['withdraw'],kamashi:['kamashi'],makuri:['makuri'],long_makuri:['long_makuri'],recover:['recover'],inside:['inside'],initiative:['resist'],front:['front'],sprint:[],endurance:[],track:['track'],block:['block'],position:['seat'],finish:['finish','outer']};
 const contextual=(no,key)=>{
  const base=input.features[no][key],own=evaluationState?.switches[no]||idOf(no),role=(evaluationState?State.members(evaluationState,own,lines)[0]:lines[own].head)===no?'leader':'follower';
  const attack=State.active(evaluationState||{}).find(a=>a.id===own),context={phase:legacyPhases[evaluationStage],role,connection:evaluationState?.detached.includes(no)?'detached':'connected',attack_type:attack?.kind==='kamashi'?'kamashi':attack?'makuri':'unknown'};
  const rows=input.records.filter(e=>e.no===no&&e.numeric&&!e.subject_ambiguous&&(mapping[key]||[]).includes(e.trait)&&Object.keys(e.context||{}).length&&Object.entries(e.context).every(([k,v])=>context[k]===v));
  const sources=[...new Map(rows.map(e=>[e.url,e])).values()];
  if(!sources.length)return base;
  const weight=sources.reduce((a,e)=>a+e.confidence,0);return {...base,value:(base.value*2+sources.reduce((a,e)=>a+e.value*e.confidence,0))/(2+weight),basis:base.basis+'＋局面・役割が一致する本文観察',sources:[...base.sources,...sources]};
 };
 const f=(no,key)=>contextual(no,key).value;
 const ev=(no,key)=>({no,key,...contextual(no,key)});
 const evidenceValue=features=>{const rows=[...new Map(features.flatMap(f=>f.sources).filter(e=>e.numeric).map(e=>[e.url,e])).values()];return rows.reduce((sum,e)=>sum+Math.min(1,e.confidence)*Math.exp(-e.ageDays/270)*(e.value-.5),0)/(1+rows.length);};
 const power=id=>f(lines[id].head,'ability'),initiative=id=>f(lines[id].head,'initiative'),who=id=>`${id}ライン（${lines[id].members.join('-')}）`;
 // Burden is an ordinal search cost, never metres, watts, elapsed seconds, or a measured fatigue value.
 const lineSupport=(s,id)=>{const followers=State.members(s,id,lines).slice(1);return followers.length?followers.reduce((sum,no)=>sum+f(no,'track')*(.6+f(no,'finish')*.4),0)/followers.length:0;};
 function initial(front,order){return {id:++serial,order:order||[front,...topology.lines.map(l=>l.id).filter(id=>id!==front)],outside:null,secondary:null,failedAttacks:[],riderBurden:{},rearJoins:[],contestHistory:[],defenses:[],burden:Object.fromEntries(topology.lines.map(l=>[l.id,0])),detached:[],switches:{},events:[],scenes:[],terms:[],assumptions:[],failures:[],used:[],attacks:[],defense:null};}
 function term(s,axis,value,reason,features=[]){s.terms.push({phase:s.scenes.length,axis,value,reason,features});}
 function intentTerm(s,id,action){
  const no=lines[id].head,rows=input.records.filter(e=>e.no===no&&e.kind==='race_intention'&&e.declaration_complete!==false).sort((a,b)=>Date.parse(b.collected_at)-Date.parse(a.collected_at)),row=rows[0];if(!row)return;
  const text=row.declaration||row.excerpt||'';if(/しない|ません|ではない|なら|れば|かもしれ|相談|昨日|前回/.test(text))return;
  const supports=/先行|積極|突っ張/.test(text)&&['press','resist','kamashi'].includes(action)||/捲り|まくり/.test(text)&&['long','short','counter'].includes(action)||/自在|位置|流れ/.test(text)&&['cut','wait','use'].includes(action);
  if(supports)term(s,'rationality',.06,`${who(id)}の今回の意思表示「${text}」を候補生成の材料にする。実行証拠とは別`,[{no,key:'race_intention',value:.06,basis:'当該レースの本人コメント。確定した戦術ではない',sources:[row]}]);
 }
 function event(s,actor,action,reason,extra={}){s.events.push({actor,action,reason,...extra});}
 function snap(s,stage){
  const p=State.project(s,lines),inside=p.groups.filter(g=>g.lane===0&&g.members.length);
  s.scenes.push({phase:PHASES[stage],groups:p.groups,positions:p.positions,order:p.order,control:p.control,middle:inside[1]?.id||null,rear:inside.at(-1)?.id||null,outside:copy(s.outside),outside_groups:copy(State.active(s)),burden:copy(s.burden),rider_burden:copy(s.riderBurden),contest:s.contest?copy(s.contest):null,connected:Object.fromEntries(r.riders.map(x=>[x.no,!s.detached.includes(x.no)&&s.innerRoute?.no!==x.no&&s.contest?.challenger!==x.no])),events:s.events.splice(0),positioning_steps:copy(s.positioning_steps||[]),positioning_goals:copy(s.positioning_goals||{}),opportunities:s.order.filter(id=>id!==p.control&&State.members(s,id,lines).length).map(id=>({line:id,options:State.active(s).some(a=>a.id===id)?['捲り継続','不発から立て直し']:['待機','位置取り','反撃']}))});
 }

 function move(s,id,to){s.order=s.order.filter(x=>x!==id);s.order.splice(to,0,id);}
 function attack(s,id,kind){
  setContext(s);
  const index=s.order.filter(x=>State.members(s,x,lines).length).indexOf(id),lead=State.project(s,lines).control,h=lines[id].head;
  if(index===0||s.outside)return [];
  const needs=kind==='long'?'long_makuri':kind==='kamashi'?'kamashi':'makuri',support=f(h,needs),supportSources=input.features[h][needs].sources;
  if(kind==='long'&&support<.5){rejected.push({phase:s.scenes.length,line:id,tactic:kind,reason:'長く踏む裏付けが弱く、後方からの早い捲りを本線候補に置けない',features:[ev(h,'long_makuri'),ev(h,'endurance')]});return [];}
  const t=copy(s);t.id=++serial;t.used.push(id);t.attacks.push({id,kind,from:index,phase:s.scenes.length});t.burden[id]+=kind==='long'?2:1;
  intentTerm(t,id,kind);
  const contact=kind==='short'&&index>1?s.order.filter(x=>State.members(s,x,lines).length)[index-1]:lead;
  t.outside={id,anchor:contact,target_line:lead,progress:index===1?'前団に接近':'中団外から進行',kind,from:index,started:s.scenes.length};
  event(t,id,kind,`${who(id)}は${index===1?'中団':'後方'}で待ち続けると進路を失うため${TACTICS[kind]}。${who(lead)}はペースを上げて迎え撃つ`);
  t.burden[lead]++;
  for(const other of s.order.filter(x=>x!==id&&x!==lead))event(t,other,'wait',`${who(other)}は外の仕掛けと前団の踏み直しを見て、無理な並走を増やさず次の進路を待つ`);
  term(t,'rationality',.2+support*.5,`${who(id)}の仕掛け機会と${needs==='long_makuri'?'長く踏む':'加速'}傾向を照合`,[ev(h,needs)]);
  term(t,'feasibility',power(id)-power(lead)*.5-index*.09-environment.outer_cost,`出発位置${index+1}番目・相手の得点差・負担を評価`,[ev(h,'ability'),ev(lines[lead].head,'ability'),...environment.features]);
  term(t,'interaction',.35,`${who(lead)}は踏み直し、残りのラインは仕掛けの後ろを利用するか位置維持を選ぶ`);
  term(t,'evidence',evidenceValue([ev(h,needs)]),supportSources.length?'局面に一致した実戦本文の方向・信頼度・時点を採用':'仕掛けの直接本文は未取得。この軸での裏付け加点はない',[ev(h,needs)]);
  // A distant late attack must not jump directly to the lead.
  if(kind==='short'&&index>1){term(t,'robustness',-.5,'後方から短い捲りは前団まで届く前提が厳しい');t.assumptions.push(`${who(id)}の短い捲りは届かず外で止まる可能性`);}
  const following=s.order[index+1];
  if(following){const ride=copy(t);ride.id=++serial;ride.outside.followers=[following];ride.burden[following]++;
   ride.events=ride.events.filter(e=>e.actor!==following);event(ride,following,'use',`${who(following)}は直前の${who(id)}の仕掛けに乗り、自ら外を踏み上げる負担を抑えて位置を上げる`);
   term(ride,'rationality',f(lines[following].head,'position')*.45,'別線利用は仕掛けの直後にいるラインだけに許す',[ev(lines[following].head,'position')]);
   ride.assumptions.push(`${who(following)}は利用する別線の仕掛けが止まれば一緒に進路を失う`);return [t,ride];
  }return [t];
 }
 const positioning=Positioning.create({r,lines,topology,f,ev,term,event,move,who,intentTerm,allocate:()=>++serial,lineSupport,power});
 function early(s){setContext(s);return positioning.early(s);}
 function launch(s,stage){
  setContext(s);
  if(s.pendingCut){
   // A cut is an opportunity, not a command to force another line to the lead.
   const cut=s.pendingCut,cutGoal=positioning.goal(cut);
   const eligible=s.order.filter(id=>id!==cut&&topology.active.includes(id)&&State.members(s,id,lines)[0]===lines[id].head);
   const base=copy(s);base.id=++serial;base.pendingCut=null;base.cut_resolution='hold_lead';base.burden[cut]++;
   event(base,cut,'press',`${who(cut)}は中団を取り直すつもりで斬ったが、別線が前へ出ないため想定外に先頭を引き受ける`);
   term(base,'rationality',cutGoal.scores.lead-cutGoal.scores.middle-.2,'先斬り側が前に残る場合、先行の利益と中団を望む利益を比較',cutGoal.sources);
   term(base,'robustness',-.15,'別線が主導権を引き受けないため当初の好位確保目的は未達');
   base.assumptions.push(`${who(cut)}の先斬り後、他線が先頭を引き受けず、自らペースを作る必要がある`);
   const remain=copy(base);
   for(const other of remain.order.slice(1)){
    const g=positioning.goal(other);
    event(remain,other,'wait',`${who(other)}は中団・捲り志向（${g.scores.middle.toFixed(2)}）と主導権志向（${g.scores.lead.toFixed(2)}）を比較し、次の仕掛け機会を残す`);
   }
   const release=[remain];
   // The rear line can begin a real outer attack, instead of being teleported to the lead.
   for(const id of eligible)for(const kind of ['kamashi','long'])release.push(...attack(base,id,kind).map(x=>({...x,cut_resolution:'outer_counter'})));
   for(const id of eligible){
    const g=positioning.goal(id),h=lines[id].head,from=s.order.indexOf(id);
    // A rear line must attack through an outside lane; it cannot jump directly into the lead.
    if(from>1)continue;
    const leadUtility=g.scores.lead-g.scores.middle+Math.min(.12,(lines[id].length-1)*.06)-from*.08;
    const t=copy(s);t.id=++serial;t.pendingCut=null;t.cut_resolution='take_lead';move(t,id,0);t.burden[id]++;
    event(t,id,'press',`${who(id)}は中団維持・捲り（${g.scores.middle.toFixed(2)}）より主導権確保（${g.scores.lead.toFixed(2)}）を選択し、${from+1}番目の位置から上昇する。ラインは${lines[id].length}車`);
    event(t,cut,'yield',`${who(cut)}は先斬り後に${who(id)}を通し、その後ろの好位を狙う。位置確保は別線との関係次第`);
    term(t,'rationality',leadUtility,'中団を捨てて主導権を取る利益を先行志向・捲り志向・ライン長・現位置から比較',g.sources);
    term(t,'feasibility',g.scores.attack*.25+f(h,'kamashi')*.25+power(id)*.20-from*.12,'再上昇に必要な加速と移動距離を比較（実測の速度や時間ではない）',[ev(h,'kamashi'),ev(h,'ability')]);
    t.assumptions.push(`${who(id)}が中団維持を捨てて主導権を取り、前団を実際に交わせることが必要`);
    for(const other of t.order.filter(x=>!t.events.some(e=>e.actor===x))){
     const og=positioning.goal(other),style=og.scores.middle>og.scores.lead?'中団確保や捲りを重視':'後方からの巻き返し時機を検討';
     event(t,other,'wait',`${who(other)}は${style}して今回は先動きを見送る（主導権志向${og.scores.lead.toFixed(2)}／好位志向${og.scores.middle.toFixed(2)}）。ただし再反撃候補も比較する`);
    }
    release.push(t);
   }
   return release;
  }
  const result=[];
  const waiting=copy(s),lead=State.project(s,lines).control;waiting.burden[lead]++;
  for(const id of s.order){
   if(!State.members(s,id,lines).length)continue;
   const at=s.order.indexOf(id),line=lines[id],ongoing=State.active(s).some(a=>a.id===id);
   const reason=id===lead?`${who(id)}は${line.length}車の連係を保ってペースを作り、別線への踏み直しを残す`:ongoing?`${who(id)}は前局面からの外進行を続け、途中で内へ戻るより仕掛けをつなぐ`:line.length===1?`${who(id)}は先行争いに加わるより、前のラインの後ろと空く進路を待って直線の脚を残す`:at===1?`${who(id)}は中団を手放して外を踏む負担と、前の仕掛けを利用する利益を比べ、現在位置を維持する`:`${who(id)}は後方から早く外を追加する負担を避け、前の仕掛けと進路の変化を待つ。強い反撃が成立する別候補とも比較する`;
   intentTerm(waiting,id,'wait');
   event(waiting,id,ongoing?'continue':'wait',reason);
  }
  term(waiting,'rationality',.25,'待機は無駄な踏み合いを避ける選択');
  const unused=s.order.slice(1).filter(id=>topology.active.includes(id)&&!s.used.includes(id)&&State.members(s,id,lines)[0]===lines[id].head);
  term(waiting,'robustness',-Math.max(0,...unused.map(id=>power(id)+f(lines[id].head,'sprint')-power(lead)-.35)),'未仕掛けの有力別線を止め続ける仮説を反証',[ev(lines[lead].head,'ability'),...unused.flatMap(id=>[ev(lines[id].head,'ability'),ev(lines[id].head,'sprint')])]);
  result.push(waiting);
  if(s.outside)return result;
  for(const id of unused){for(const kind of stage===2?['kamashi','long']:['short'])result.push(...attack(s,id,kind));}
  return result;
 }
 function defense(s){
  setContext(s);
  if(!s.outside){const t=copy(s);event(t,State.project(s,lines).control,'vertical','外からの攻撃がないので牽制のため横に動く理由がなく、直線へ向け縦に踏む');term(t,'robustness',.05,'余分なブロック成功を前提としない');return [t];}
  const attackId=s.outside.id,defId=s.outside.anchor,att=lines[attackId],def=lines[defId],follower=State.members(s,defId,lines)[1],index=s.outside.from;
  const attackingTrait=s.outside.kind==='long'?'long_makuri':s.outside.kind==='kamashi'?'kamashi':'makuri';
  const attackStrength=power(attackId)+f(att.head,attackingTrait)*.45-s.burden[attackId]*.07;
  const defenseBase=power(defId)-s.burden[defId]*.06;
  const result=[];
  for(const action of follower?['block','vertical']:['vertical'])for(const outcome of ['success','partial','failure']){
   const t=copy(s);t.id=++serial;const riding=[...(s.outside.followers||[])];t.defense={actor:follower||def.head,action,outcome,attacker:att.head};
   const defenseStrength=defenseBase+(action==='block'&&follower?f(follower,'block')*.25:0),margin=attackStrength-defenseStrength;
   // Rear short attacks have not reached the leading pair at the corner.
   if(outcome==='failure'&&['short','counter','relaunch'].includes(s.outside.kind)&&index>1){rejected.push({line:attackId,tactic:'short',reason:'後方から最終バックで動いた短い捲りを一局面で先頭へ移す根拠がない'});continue;}
   if(action==='vertical'&&outcome==='partial')continue;
   if(outcome==='failure'){
    move(t,attackId,0);t.outside=null;term(t,'feasibility',margin,'攻撃側が前団を越える条件を比較',[ev(att.head,'ability'),ev(att.head,attackingTrait),ev(def.head,'ability'),...(follower?[ev(follower,'block')]:[])]);
    event(t,attackId,'pass',`${who(attackId)}は前局面からの外進行を継続し${who(defId)}を乗り越える`);
    if(action==='block')t.burden[defId]++;
   }else if(outcome==='success'){
    t.outside=null;move(t,attackId,Math.min(t.order.length-1,Math.max(2,s.outside.from)));t.burden[attackId]++;t.failedAttacks.push({...s.outside,stage:s.scenes.length,status:'failed'});
    term(t,'feasibility',-margin,'攻撃側が止まる条件・守備側の牽制傾向を照合',[ev(att.head,attackingTrait),ev(att.head,'ability'),ev(def.head,'ability'),...(follower&&action==='block'?[ev(follower,'block')]:[])]);
    event(t,attackId,'stalled',`${who(attackId)}は外で前団を越せず、後退して立て直す`);
   }else{
    t.outside.progress=['short','counter','relaunch'].includes(s.outside.kind)&&index>1?'中団の外で並走を継続':'前団外で並走継続';t.burden[attackId]++;t.burden[defId]++;
    term(t,'feasibility',.25-Math.abs(margin),'牽制は攻撃を遅らせるが、完全には止めない',[ev(att.head,attackingTrait),ev(att.head,'ability'),ev(def.head,'ability'),...(follower?[ev(follower,'block')]:[])]);
    event(t,attackId,'parallel','牽制で進行を遅らせられるが、外並走を続ける');
   }
   for(const ridingId of riding){if(outcome==='failure')move(t,ridingId,1);else if(outcome==='success')move(t,ridingId,Math.min(t.order.indexOf(attackId)+1,t.order.length-1));event(t,ridingId,'use',outcome==='failure'?'利用した別線が前団を越えたため、その後ろで位置を上げる':outcome==='partial'?'利用した別線とともに外で並走し、自身も脚を使う':'利用した別線が止まり、その後ろから立て直す');t.burden[ridingId]++;}
   if(follower){t.riderBurden[follower]=(t.riderBurden[follower]||0)+(action==='block'?2:1);}
   event(t,defId,action,action==='block'?`${follower}番は先行を残すため牽制。${outcome==='success'?'止める':outcome==='partial'?'遅らせるが外並走が残る':'止め切れず自身も脚を使う'}`:'番手は横への対応で進路を失うより、縦に踏んで着を確保する');
   term(t,'rationality',action==='block'&&follower?f(follower,'block')-.2:.25,'牽制の採用理由と縦踏みの利益を比較',follower?[ev(follower,'block')]:[]);
   term(t,'interaction',.5,'攻撃側の進行と守備側の負担を同時更新');
   term(t,'robustness',outcome==='failure'&&margin<0?-.6:outcome==='success'&&margin>0?-.5:0,'相手より不利な条件での都合のよい成功には不利な評価');
   t.assumptions.push(`${who(attackId)}の仕掛けに対し${who(defId)}が${action==='block'?'牽制':'縦踏み'}し、${outcome==='success'?'前団を守る':outcome==='partial'?'並走が残る':'乗り越えられる'}こと`);
   result.push(t);
  }return result;
 }
 function defendAll(s){
  if(!s.secondary){return defense(s).map(t=>{if(t.defense)t.defenses.push(copy(t.defense));return t;});}
  const result=[];
  // Compare both possible response orders; do not let iteration order decide the lead.
  for(const reversed of [false,true]){
   const start=copy(s),a=reversed?s.secondary:s.outside,b=reversed?s.outside:s.secondary;start.outside=copy(a);start.secondary=null;
   for(const first of defense(start)){
    if(first.defense)first.defenses.push(copy(first.defense));const pending=copy(first.outside),next=copy(first);const projected=State.project(first,lines),inner=projected.groups.filter(g=>g.lane===0&&g.members.length&&g.id!==b.id);const target=['short','counter','relaunch'].includes(b.kind)&&b.from>1?(inner.at(-1)?.id||projected.control):projected.control;next.outside={...copy(b),anchor:target};next.secondary=pending;
    for(const second of defense(next)){if(second.defense)second.defenses.push(copy(second.defense));const remaining=second.outside;second.outside=pending;second.secondary=remaining;
     if(!second.outside&&second.secondary){second.outside=second.secondary;second.secondary=null;}result.push(second);
    }
   }
  }return result;
 }
 function followers(s){
  setContext(s);const result=[s];
  for(const id of s.order){const connected=State.members(s,id,lines);if(connected.length<2||!s.attacks.some(a=>a.id===id))continue;
   for(let at=1;at<connected.length;at++){const no=connected[at],risk=f(no,'track')-f(connected[0],'sprint')*.45-s.burden[id]*.025;if(risk>=.32)continue;
    const t=copy(s);t.id=++serial;t.detached=[...new Set([...t.detached,...connected.slice(at)])];
    for(const n of connected.slice(at)){delete t.switches[n];t.riderBurden[n]=(t.riderBurden[n]||0)+1;}
    event(t,id,'detach',`${no}番以降は${at===1?'先頭の加速':'前走者の加速'}で追走が離れる。以後は元の番手位置を自動的には使えない`);
    term(t,'feasibility',.32-risk,'先頭の加速・当該選手の追走特性・現在の負担から分断を比較',[ev(no,'track'),ev(connected[0],'sprint')]);result.push(t);
   }
  }
  for(const solo of topology.solos){const no=lines[solo].head,at=s.order.indexOf(solo),target=s.attacks.at(-1)?.id;if(!target||s.switches[no]||at!==s.order.indexOf(target)+1)continue;
   if(!s.detached.includes(lines[target].members[1]))continue;
   const t=copy(s);t.id=++serial;t.switches[no]=target;event(t,solo,'seat',`${who(solo)}は直前の仕掛けラインの追走離れで空いた番手へ切り替える`);term(t,'feasibility',f(no,'position')-.2,'直前の位置と番手の空席を同時に確認',[ev(no,'position')]);result.push(t);
  }return result;
 }
 
 function soloResponse(s){
  setContext(s);const result=[s],lead=State.project(s,lines).control,vacancy=s.detached.some(n=>idOf(n)===lead);
  for(const solo of topology.solos){const no=lines[solo].head,at=s.order.indexOf(solo);if(at!==1||s.contest||!State.members(s,lead,lines)[1]||s.switches[no]||s.detached.includes(no))continue;
   if(!vacancy&&f(no,'position')<.55)continue;
   for(const outcome of vacancy?['seat']:['seat_partial','seat_fail']){
    const t=copy(s);t.id=++serial;
    if(outcome==='seat')t.switches[no]=lead;
    if(outcome==='seat_partial'){
     // A contested second position does not erase the incumbent; retain parallel lanes.
     t.contest={outcome:'unresolved',challenger:no,incumbent:State.members(s,lead,lines)[1],target:lead};t.burden[solo]++;t.burden[lead]++;
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
  for(const s of states){const key=[s.order.join(''),s.pendingCut||'',s.cut_resolution||'',JSON.stringify(s.burden),s.events.map(e=>e.actor+':'+e.action+':'+(e.outcome||'')).join(','),s.outside?.id,s.outside?.kind,s.secondary?.id,s.secondary?.kind,s.innerRoute?.no,s.contest?.challenger,s.contest?.outcome,JSON.stringify(s.contestHistory),JSON.stringify(s.failedAttacks),s.defense?.action,s.defense?.outcome,s.detached.join(),JSON.stringify(s.switches),JSON.stringify(s.rearJoins),JSON.stringify(s.riderBurden),s.attacks.map(a=>a.kind).join()].join('|');if(!buckets.has(key)||rank(s)>rank(buckets.get(key)))buckets.set(key,s);}
  const sorted=[...buckets.values()].sort((a,b)=>rank(b)-rank(a)||a.id-b.id),selected=[],families=new Map();
  // Round-robin across state families, so failure/recovery never vanishes merely
  // because many initial S-order variants of a successful move rank ahead.
  for(const s of sorted){const earlyEvents=s.scenes[1]?.events||s.events,earlyTactic=earlyEvents.find(e=>['cut','press'].includes(e.action))?.action||'hold',earlyResponse=earlyEvents.find(e=>['resist','yield'].includes(e.action))?.action||'wait';const key=[earlyTactic,earlyResponse,s.cut_resolution||'none',s.outside?.kind||'none',s.secondary?.kind||'none',s.failedAttacks.some(a=>a.status==='failed')?'failed':'',s.retry?'retry':'',s.innerRoute?'inside':'',s.recoveredLines?.length?'reset':'',s.recoveredRiders?.length?'rejoined':'',s.detached.length?'detached':'',s.contestHistory.at(-1)?.outcome||s.contest?.outcome||'',s.defense?.action||'',s.defense?.outcome||''].join('|');if(!families.has(key))families.set(key,[]);families.get(key).push(s);}
  let round=0;while(selected.length<width){let added=0;for(const bucket of families.values()){if(bucket[round]&&selected.length<width){selected.push(bucket[round]);added++;}}if(!added)break;round++;}
  counts.pruned+=states.length-selected.length;return selected;

 }
 const advanced=Interactions.create({r,lines,topology,f,ev,event,term,move,who,allocate:()=>++serial,setContext});
 const starts=frontChoices(r,topology,input.records);
 rejected.push(...starts.excluded.map(x=>({phase:0,line:x.line,tactic:'solo_s_start',reason:x.reason})));
 let states=starts.choices.flatMap(({line,solo_reason})=>Positioning.initialOrders(topology,line.id).map(({order,basis})=>{
  const s=initial(line.id,order),eligible=line.members.filter(no=>Number.isFinite(by[no].s)&&by[no].s>0&&!by[no].meta?.absent_fields?.includes('s'));
  eligible.sort((a,b)=>by[b].s-by[a].s||a-b);
  const sTaker=line.length===1?line.head:(eligible[0]||null);
  const sBasis=line.length===1?(solo_reason||'単騎のS担当は未確定'):sTaker===null?'S本数の取得不足により担当候補は未確定':sTaker+'番はライン内でS本数が最も多い担当候補（確定ではない）';
  s.startPlan={front_line:line.id,s_taker_no:sTaker,s_taker_basis:sBasis,solo_front_reason:solo_reason||null,initial_order:[...order],initial_order_basis:basis};
  const sStrength=sTaker===null ? .4 : f(sTaker,'front'),lineCoordination=line.length>1 ? .06*Math.min(3,line.length-1) : 0;
  term(s,'rationality',.25+sStrength*.35+lineCoordination,who(line.id)+'の初手前受けとSを取る担当者を分けて評価。'+sBasis,[ev(sTaker||line.head,'front')]);
  event(s,line.id,'front',who(line.id)+'が初手の前受け候補。'+sBasis+'。他線と単騎は別に位置取りを考える');
  snap(s,0);s.scenes[0].start_plan=copy(s.startPlan);return s;
 }));
 evaluationStage=1;states=trim(states.flatMap(early).flatMap(s=>advanced.contest(s,1)));states.forEach(s=>snap(s,1));
 evaluationStage=2;const homePlans=states.flatMap(s=>launch(s,2));const cut_choices=Object.fromEntries(['hold_lead','take_lead','outer_counter'].map(k=>[k,homePlans.filter(x=>x.cut_resolution===k).length]));states=trim(homePlans.flatMap(advanced.homeFailure).flatMap(followers));states.forEach(s=>snap(s,2));
 // Existing external attacks first continue; new attacks at the back cannot jump to the front.
 evaluationStage=3;states=trim(states.flatMap(s=>launch(s,3)).flatMap(advanced.recovery).flatMap(advanced.counter).flatMap(s=>advanced.contest(s,3)));states.forEach(s=>snap(s,3));
 evaluationStage=4;states=trim(states.flatMap(defendAll).flatMap(followers).flatMap(s=>soloResponse(s)).flatMap(advanced.inside));states.forEach(s=>snap(s,4));
 evaluationStage=5;const finishHypotheses=[];
 for(const state of states){
  setContext(state);
  const lead=State.project(state,lines).control,line=lines[lead],head=line.head,second=state.scenes[4].groups.find(g=>g.id===lead)?.members[1],third=state.scenes[4].groups.find(g=>g.id===lead)?.members[2],burden=state.burden[lead];
  const leaderStrength=f(head,'ability')*.5+f(head,'endurance')*.5-burden*.07-environment.lead_cost*Math.min(2,burden/3);
  const followStrength=second&&!state.detached.includes(second)?f(second,'ability')*.45+f(second,'finish')*.4+f(second,'track')*.15+environment.finish_allowance*f(second,'finish')-(state.riderBurden[second]||0)*.055:-1;
  const pairs=[{pair:[head,second],mode:'先行残り',margin:leaderStrength-followStrength},{pair:[second,head],mode:'番手差し',margin:followStrength-leaderStrength}].filter(x=>x.pair.every(Boolean)&&!state.detached.includes(x.pair[0]));
  if(!second){const next=state.order.filter(id=>id!==lead&&!State.active(state).some(a=>a.id===id)&&State.members(state,id,lines).length)[0];if(next)pairs.push({pair:[head,lines[next].head],mode:'単騎先頭からの直線',margin:leaderStrength-.4});}
  for(const a of State.active(state)){if(['short','counter','relaunch'].includes(a.kind)&&a.from>1)continue;const attacker=lines[a.id].head;pairs.push({pair:[attacker,head],mode:'外並走から直線で捲り切り',margin:f(attacker,'sprint')*.5+f(attacker,'ability')*.5-state.burden[a.id]*.08-leaderStrength});}
  if(state.innerRoute){const n=state.innerRoute.no;pairs.push({pair:[n,second||head],mode:'内進路からの直線',margin:f(n,'inside')*.4+f(n,'finish')*.4+f(n,'ability')*.2-(state.riderBurden[n]||0)*.08-leaderStrength});}
  if(third&&!state.detached.includes(third)&&f(third,'finish')>f(head,'finish')+.15)pairs.push({pair:[third,second||head],mode:'3番手の直線勝負',margin:f(third,'finish')-leaderStrength-.2});
  for(const fin of pairs){const s=copy(state);s.id=++serial;
   term(s,'feasibility',fin.margin,`${fin.mode}は先行負担・残る脚・番手の追走／牽制負担を独立比較`,[ev(head,'ability'),ev(head,'endurance'),...(second?[ev(second,'ability'),ev(second,'finish'),ev(second,'track')]:[]),...(![head,second].includes(fin.pair[0])?[ev(fin.pair[0],'ability'),ev(fin.pair[0],'sprint'),ev(fin.pair[0],'finish')]:[])]);
   const corner=s.scenes[4],position=n=>corner.positions?.[n]?.ordinal??corner.order.indexOf(n),available=corner.order.filter(n=>!fin.pair.includes(n));
   const thirdRank=available.map(no=>({no,comparison:f(no,'finish')+f(no,'ability')*.3-position(no)*.07-(s.detached.includes(no)?.35:0)-(s.riderBurden[no]||0)*.04+(s.innerRoute?.no===no?.1:0),reason:`${no}番は${corner.positions?.[no]?.band==='outside'?'4角の前団外':corner.positions?.[no]?.band==='inside'?'開いた内進路':corner.positions?.[no]?.band==='contest'?'競りの位置':`4角の内側隊列${position(no)+1}番手`}から直線。${corner.groups.find(g=>g.members.includes(no))?.id===lead?'同ラインの連結を保つ':'前団との位置差と伸びを比較'}。`,features:[ev(no,'finish'),ev(no,'ability')]})).sort((a,b)=>b.comparison-a.comparison);
   const best=thirdRank[0],thirds=thirdRank.filter(x=>x.comparison>=best.comparison-.13&&position(x.no)<=4&&!s.detached.includes(x.no)).slice(0,r.riders.length-2);
   if(!thirds.length)thirds.push(best);
   if(fin.mode==='内進路からの直線')term(s,'rationality',f(fin.pair[0],'inside')-.3,'実際に開いた内の進路を直線の勝ち筋につなぐ',[ev(fin.pair[0],'inside'),ev(fin.pair[0],'finish')]);
   if(environment.features.length)term(s,'feasibility',fin.mode==='番手差し'?environment.lead_cost+environment.finish_allowance:-environment.lead_cost,'出典付きのバンク・風の観測による小幅な条件比較',environment.features);
   s.finish={...fin,leaderStrength,followStrength,thirds};
   const favorable=s.scenes.flatMap(x=>x.events).filter(e=>['pass','seat_won','relaunch','reconnect','inside'].includes(e.action)).length;
   if(favorable>1)term(s,'robustness',-.12*(favorable-1),'複数の都合のよい成功が続く前提は頑健性を下げる');
   s.assumptions.push(`${fin.mode}には先行の負担と番手の余力の大小関係が維持されることが必要`);
   event(s,lead,'finish',`${fin.mode}を主要決着とし、${fin.pair.join('→')}。主導権の負担と番手の余力を比べた結論`);
   snap(s,5);s.scenes[5].order=[...fin.pair,thirds[0].no,...corner.order.filter(n=>!fin.pair.includes(n)&&n!==thirds[0].no)];
   s.scenes[5].finish_order=true;finishHypotheses.push(s);
  }
 }
 if(!finishHypotheses.length)throw Error('成立する決着候補がありません');
 // Hard constraints cannot be rescued by an axis weight.
 const valid=finishHypotheses.filter(s=>{s.audit=State.audit(s,r,lines);if(!s.audit.passed)rejected.push({id:s.id,reason:s.audit.failures.join('。')});return s.audit.passed;});
 if(!valid.length)throw Error('局面状態の整合性を満たす候補なし');
 const selected=Selection.select(valid),{main,rival,decision,rated,alternatives}=selected,{gap}=decision,weight=decision.weights;
 decision.sensitivity=Sensitivity.review(main,rated,weight);
 const {tickets,policy:ticket_policy}=Tickets.generate(main,alternatives,input);

 return {schema:'tk-keirin-line/v1',version:VERSION,generated_at:new Date().toISOString(),mode:!options.replay&&Date.parse(input.as_of)<Date.parse(input.cutoff)?'pre-race':'historical-replay',provenance:{input_sha256:Provenance.sha256(input),model:Build,search_settings:{width,trace_candidates:!!options.traceCandidates},input_as_of:input.as_of,cutoff:input.cutoff},input,environment,topology,main,decision,rival,alternatives,candidate_evaluations:valid.map(s=>({id:s.id,score:Object.keys(AXES).reduce((sum,k)=>sum+subtotal(s,k)*weight[k],0),axes:Object.fromEntries(Object.keys(AXES).map(k=>[k,subtotal(s,k)])),audit:s.audit,pair:s.finish.pair,mode:s.finish.mode,attacks:s.attacks,defense:s.defense,defenses:s.defenses,detached:s.detached,recovered_lines:s.recoveredLines||[],recovered_riders:s.recoveredRiders||[],inside:s.innerRoute||null,contest:s.contest||null,contest_history:s.contestHistory,cut_resolution:s.cut_resolution||null,...(options.traceCandidates?{terms:s.terms,scenes:s.scenes.map(x=>({phase:x.phase,control:x.control,order:x.order,positions:x.positions,groups:x.groups,events:x.events,positioning_steps:x.positioning_steps,positioning_goals:x.positioning_goals}))}:{})})),tickets,ticket_policy,compressed:compress(tickets),rejected,uncertainty:input.uncertainty,search:{...counts,width,...(options.traceCandidates?{cut_choices}:{}),audit_passed:valid.length,pareto:selected.pareto,finalists:selected.finalists,retained:rated.length,method:'ライン戦術別の候補保持→局面更新→矛盾棄却→動的判断軸比較',limited:true},value_assessment:'オッズ未評価。比較評価は確率・成功率・購入価値ではない。'};
}
function compress(tickets){const groups=new Map();for(const t of tickets){const k=t.trio.slice(0,2).join('-');if(!groups.has(k))groups.set(k,new Set());groups.get(k).add(t.trio[2]);}return [...groups].map(([k,thirds])=>({text:k+'-'+[...thirds].sort((a,b)=>a-b).join(''),count:thirds.size}));}
const api={VERSION,PHASES,AXES,TACTICS,structure,frontChoices,build,compress};if(typeof module!=='undefined')module.exports=api;root.LineEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this);
