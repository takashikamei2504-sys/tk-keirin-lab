/* B-AXIS independent six-phase race hypothesis model.
 * The selected final-back rider is the ONLY forced result. Rider/line winners are never forced.
 * All units below are ordinal/relative tactical values, not measured speed or metres.
 */
(function(root){'use strict';
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const round=v=>Math.round(v*1000)/1000;
const Follow=typeof module!=='undefined'?require('./follow.js'):root.BAxisFollow;
const STAGES=[
 {id:'initial',label:'① 初手・前受け',index:0},
 {id:'red_bell',label:'② 赤板〜打鐘',index:1},
 {id:'home',label:'③ 最終ホーム',index:2},
 {id:'back',label:'④ 最終バック',index:3},
 {id:'corner',label:'⑤ 3〜4コーナー',index:4},
 {id:'finish',label:'⑥ 直線・ゴール',index:5}
];
function value(features,no,key,fallback=.45){
 const x=features?.[no]?.[key]?.value;
 return Number.isFinite(x)?clamp(x):fallback;
}
function checkRaw(race,bNo,mode){
 const ids=race?.riders?.map(x=>x.no)||[];
 if(![7,9].includes(ids.length)||new Set(ids).size!==ids.length||!race.lineup?.length||new Set(race.lineup.flat()).size!==ids.length||!ids.every(n=>race.lineup.flat().includes(n)))throw Error('B-AXIS: 全選手の重複しない並びが必要');
 if(!ids.includes(bNo))throw Error('B-AXIS: B選手は出走選手のみ');
 if(!['press','hold','kamashi','makuri','surge','relaunch','solo_shift'].includes(mode))throw Error('B-AXIS: 未対応の獲得戦法');
}
function simulate(race,features,bNo,mode,tacticLabel,historyModel=null){
 checkRaw(race,bNo,mode);
 const riders=new Map(race.riders.map(r=>[r.no,r]));
 const groups=race.lineup.map((members,id)=>({id,members:members.slice(),head:members[0]}));
 const lookup=new Map(groups.flatMap(g=>g.members.map((n,i)=>[n,{group:g,originalIndex:i}])));
 const owner=lookup.get(bNo).group,ownerIndex=lookup.get(bNo).originalIndex;
 const feat=(n,k,d)=>value(features,n,k,d);
 const ability=n=>feat(n,'ability',.4);
 const power=n=>feat(n,'sprint',.4);
 const front=n=>feat(n,'front',.4);
 const initiative=n=>feat(n,'initiative',.4);
 const track=n=>feat(n,'track',.45);
 const rivalForce=g=>{
  const x=riders.get(g.head),self=x.style!=='追';
  return self?clamp(initiative(g.head)*.34+power(g.head)*.37+ability(g.head)*.23+(g.members.length>=3?.055:0)):.10+ability(g.head)*.10;
 };
 const rivals=groups.filter(g=>g!==owner).sort((a,b)=>rivalForce(b)-rivalForce(a)||a.id-b.id);
 const sortedByFront=rivals.slice().sort((a,b)=>(front(b.head)*.63+initiative(b.head)*.37)-(front(a.head)*.63+initiative(a.head)*.37)||a.id-b.id);
 const starter=sortedByFront[0]||owner,baseOpp=rivals[0]||null,pressure=baseOpp?rivalForce(baseOpp):0;
 const tacticalAttack=['kamashi','makuri','solo_shift'].includes(mode);
 const ownerFirst=['press','surge','relaunch'].includes(mode)||(starter===owner&&!tacticalAttack);
 const firstLine=ownerFirst?owner:(starter===owner&&rivals.length?rivals[0]:starter);
 const rest=groups.filter(g=>g!==firstLine).sort((a,b)=>{
   const aOw=a===owner,bOw=b===owner;
   if(aOw||bOw){
     if(['makuri'].includes(mode))return aOw?1:-1;
     return aOw?-1:1;
   }
   return front(b.head)-front(a.head)||a.id-b.id;
 });
 const initial=[firstLine,...rest];
 function toFront(order,id){
  const target=order.find(g=>g.id===id);
  return [target,...order.filter(g=>g.id!==id)];
 }
 function toSecond(order,id){
  const target=order.find(g=>g.id===id);
  const other=order.filter(g=>g.id!==id);
  return other.length?[other[0],target,...other.slice(1)]:[target];
 }
 const makuriPosition=Math.max(1,initial.findIndex(g=>g.id===owner.id)-2);
 const toIndex=(order,id,index)=>{const target=order.find(g=>g.id===id),rest=order.filter(g=>g.id!==id);rest.splice(Math.min(index,rest.length),0,target);return rest;};
 const bell=['hold'].includes(mode)?toFront(initial,owner.id):
   mode==='makuri'?toIndex(initial,owner.id,makuriPosition):
   mode==='kamashi'?toSecond(initial,owner.id):
   ['solo_shift'].includes(mode)?toSecond(initial,owner.id):
   initial.slice();
 const home=['kamashi','makuri','solo_shift'].includes(mode)?toSecond(bell,owner.id):bell.slice();
 const back=toFront(home,owner.id);
 const headOf=order=>order[0].head;
 const effort=Object.fromEntries(race.riders.map(r=>[r.no,.018]));
 const trackGap=n=>Math.max(0,.61-track(n));
 const available=(g)=>riders.get(g.head).style!=='追'&&rivalForce(g)>.38;
 const surgeMove=['surge','relaunch'].includes(mode),fastMove=['kamashi','makuri','relaunch','solo_shift'].includes(mode);
 const followerGroup=g=>{
  if(g!==owner)return g.members;
  if(ownerIndex===0)return g.members;
  // A follower's B lead requires explicit switch: original head may lose contact.
  return [bNo,...g.members.slice(ownerIndex+1),...g.members.slice(0,ownerIndex)];
 };
 const startHead=initial[0].head;
 function simplePositions(order,phase){
  const outside=phase==='home'&&(fastMove||mode==='surge')?owner.id:null;
  const rows=[];let ordinal=0;
  for(const g of order){
   const members=phase==='home'&&surgeMove?followerGroup(g):g.members;
   for(const n of members){
    rows.push({no:n,ordinal:ordinal++,lane:g.id===outside&&(!['surge','relaunch'].includes(mode)||n===bNo)?1:0,gap:round((ordinal-1)*.75),spent:round(effort[n]),remaining:round(clamp(.96-effort[n]+feat(n,'endurance')*.10))});
   }
  }
  return rows;
 }
 function charge(stage){
  for(const r of race.riders){
   const n=r.no,at=lookup.get(n),isOwner=at.group===owner,isB=n===bNo;
   let cost=stage==='red_bell'?.030:stage==='home'?.040:.042;
   if(stage==='red_bell'){
    if(isB)cost+=({press:.075,hold:.15,kamashi:.035,makuri:.025,surge:.035,relaunch:.028,solo_shift:.040})[mode];
    if(at.group===starter&&starter!==owner&&at.originalIndex===0)cost+=.025;
   }else if(stage==='home'){
    if(isB)cost+=({press:.165,hold:.08,kamashi:.23,makuri:.235,surge:.20,relaunch:.265,solo_shift:.26})[mode];
    if(at.group===starter&&starter!==owner&&at.originalIndex===0)cost+=.065;
    if(isOwner&&!isB&&at.originalIndex>ownerIndex)cost+=fastMove?.070:.028;
    if(isOwner&&!isB&&at.originalIndex<ownerIndex)cost+=.125;
    if(!isOwner&&at.originalIndex===0&&available(at.group))cost+=.070*rivalForce(at.group);
   }else if(stage==='back'){
    if(isB)cost+=({press:.17,hold:.12,kamashi:.17,makuri:.18,surge:.145,relaunch:.19,solo_shift:.18})[mode]+pressure*.09;
    if(at.group===owner&&!isB&&at.originalIndex>ownerIndex)cost+=.045+trackGap(n)*.07;
    if(at.group===owner&&!isB&&at.originalIndex<ownerIndex)cost+=.095;
    if(at.group!==owner&&at.originalIndex===0&&available(at.group))cost+=.045+Math.max(0,rivalForce(at.group)-.45)*.11;
   }
   effort[n]=round(clamp(effort[n]+cost,0,.89));
  }
 }
 function phase(id,order,events,extra={}){
  return {id,label:STAGES.find(x=>x.id===id).label,order:order.flatMap(g=>g.members),lineOrder:order.map(g=>g.members.slice()),events,positions:simplePositions(order,id),...extra};
 }
 const initialEvents=[{actor:startHead,action:'front',reason:startHead+'番の前受けを初手の基準に設定（出走表からの戦術仮説）'}];
 if(ownerFirst&&ownerIndex>0)initialEvents.push({actor:owner.head,action:'line_front',reason:'B候補の元ラインは前受け、後位からのB奪取は最終ホーム以降に発生'});
 const scenes=[phase('initial',initial,initialEvents,{leader:startHead})];
 charge('red_bell');
 const redEvents=[];
 if(bell[0]!==initial[0]){
  redEvents.push({actor:owner.head,action:'cut',target:initial[0].head,reason:owner.head+'番のラインが赤板〜打鐘で前へ押さえ、初手先頭'+initial[0].head+'番が後ろへ回る'});
 }else if(mode==='press'){
  redEvents.push({actor:owner.head,action:'resist',target:starter!==owner?starter.head:null,reason:'前受けのまま別線の押さえに抵抗し、先行権を守る'});
 }else if(mode==='makuri'){
  const moves=initial.findIndex(g=>g.id===owner.id)-bell.findIndex(g=>g.id===owner.id);
  redEvents.push({actor:bNo,action:moves?'advance':'wait',reason:moves?'赤板〜打鐘で後方から中団へ'+moves+'ライン分進出し、最終ホームの捲りに備える':'中団で仕掛けの機会を待ち、最終ホームの捲りに備える'});
 }else if(mode==='kamashi'){
  redEvents.push({actor:bNo,action:'wait',reason:'赤板〜打鐘では先頭を取り切らず、中団からカマシの機会をうかがう'});
 }else if(mode==='surge'||mode==='relaunch'){
  redEvents.push({actor:owner.head,action:'pace',reason:'元ライン先頭が主導権を保持し、後位'+bNo+'番の発進機会を残す'});
 }else if(mode==='hold'){
  redEvents.push({actor:bNo,action:'pace',reason:'前受けから先行ペースを作り、他線の押さえを受け止める'});
 }else{
  redEvents.push({actor:bNo,action:'position',reason:'単騎の中団位置を確保し、前の仕掛けに反応する'});
 }
 if(bell[0]!==initial[0]&&!redEvents.some(e=>e.action==='cut'))throw Error('主導権変化の戦術説明がない');
 scenes.push(phase('red_bell',bell,redEvents,{leader:headOf(bell)}));
 charge('home');
 const homeEvents=[];
 if(['kamashi','makuri'].includes(mode)){
  homeEvents.push({actor:bNo,action:mode,target:headOf(home),reason:bNo+'番が最終ホームから外を踏み、'+headOf(home)+'番のラインの前へ出るために加速'});
  if(starter!==owner)homeEvents.push({actor:starter.head,action:'resist',target:bNo,reason:starter.head+'番は外から迫る'+bNo+'番に対し先行権を簡単には譲らない'});
 }else if(mode==='press'){
  homeEvents.push({actor:bNo,action:'press',reason:'最終ホームまで突っ張り、対抗自力の巻き返しに備える'});
 }else if(mode==='hold'){
  homeEvents.push({actor:bNo,action:'pace',reason:'押さえ先行からペースを上げ、外の反撃を封じにかかる'});
 }else if(['surge','relaunch'].includes(mode)){
  homeEvents.push({actor:bNo,action:'surge',target:owner.head,reason:owner.head+'番の先行から、'+bNo+'番が後位で自力発進。元ライン先頭は前から後ろへ切り替える'});
 }else{
  homeEvents.push({actor:bNo,action:'solo_move',target:headOf(home),reason:'単騎の'+bNo+'番が追走位置から外へ切り替え、ホームで先頭を狙う'});
 }
 for(const g of rivals.filter(available).slice(0,2)){
  const inFront=home[0]===g;
  homeEvents.push({actor:g.head,action:inFront?'resist':'counter',target:bNo,reason:inFront?'前で主導権に抵抗':'中団・後方からの反撃を検討し、最終B直後の射程を争う'});
 }
 scenes.push(phase('home',home,homeEvents,{leader:headOf(home),outer:fastMove?bNo:null}));
 charge('back');
 // The only forced state is the B-front rider. The position of everybody else
 // must be explained by early phases and the tactical passage events above.
 const passageEvents=[];
 if(ownerIndex>0){
  passageEvents.push({actor:bNo,action:'reorder',target:owner.head,reason:bNo+'番が元ラインの'+(ownerIndex+1)+'番手から前に出る。元先頭は後ろへ切替え'});
 }
 if(home[0]!==owner){
  if(!['kamashi','makuri','solo_shift'].includes(mode))throw Error('Bで突然の主導権交代');
  passageEvents.push({actor:bNo,action:'pass',target:headOf(home),reason:mode==='kamashi'?'カマシで前ラインを最終Bまでに交わす':mode==='makuri'?'ホームからの捲りで先頭ラインを最終Bまでに交わす':'単騎の仕掛けで最終B手前に先頭を交わす'});
 }else passageEvents.push({actor:bNo,action:'retain',reason:'選択Bの'+bNo+'番が最終バックで先頭を維持'});
 const memberOrder=back.map(g=>g===owner?{...g,members:followerGroup(g)}:g);
 const orderedGroups=memberOrder.map(g=>({...g,members:g.members.slice()}));
 const positionByNo=new Map();
 const headGap=new Map();
 for(const g of rivals){
  const rank=rivals.indexOf(g),force=rivalForce(g),head=riders.get(g.head);
  const wasLeader=home[0]===g;
  const countering=available(g);
  const base=wasLeader&&['kamashi','makuri','solo_shift'].includes(mode)?1.35:
      countering&&force>.60?1.7:countering?2.30:3.05;
  headGap.set(g.id,base+rank*.55+Math.max(0,.53-force)*1.0+(mode==='press'?.12:0));
  if(head.style==='追')headGap.set(g.id,Math.max(2.8,headGap.get(g.id)));
 }
 const states=[];
 for(const g of orderedGroups){
  let localGap=0;
  for(let i=0;i<g.members.length;i++){
   const n=g.members[i],r=riders.get(n),originalIndex=lookup.get(n).originalIndex;
   const isOwner=g.id===owner.id,one=n===bNo;
   const tracking=track(n),endurance=feat(n,'endurance'),abilityVal=ability(n),
         sprint=power(n),finish=feat(n,'finish'),makuri=feat(n,'makuri');
   let gap=0,role='',trackLabel='追走',attack=false,entry='',following=null;
   if(one){role='B先頭';trackLabel='先頭';entry='Bを先頭通過する固定条件';}
   else if(isOwner){
    const shifted=originalIndex<ownerIndex;
    const preceding=riders.get(g.members[i-1]);
    following=Follow.profile(features,r,preceding,{fast:fastMove||['surge','relaunch'].includes(mode),switched:shifted,date:race.date,history:historyModel});
    localGap+=following.wheelGap;
    gap=localGap;
    role=shifted?'元ライン前方・切替':i===1?'B番手':'Bライン追走';
    trackLabel=following.status==='detached'?'追走離れ気味':following.status==='gap_opened'?'追走車間あり':shifted?'切替追走':'追走';
    entry=shifted?'前を走っていた選手が後方へ切替。連結は自動保証しない':following.basis+'。直前の'+preceding.no+'番の踏み出しを追走する';
   }else{
    const force=rivalForce(g),self=riders.get(g.head).style!=='追';
    const first=i===0;
    if(first)gap=headGap.get(g.id);
    else {
     const preceding=riders.get(g.members[i-1]);
     following=Follow.profile(features,r,preceding,{fast:force>.6,date:race.date,history:historyModel});
     localGap+=following.wheelGap;
     gap=headGap.get(g.id)+localGap;
    }
    attack=first&&self&&force>.38&&gap<=4.0;
    role=first?(self?'別線自力・仕掛け候補':'単騎／別線追込・切替待ち'):'別線追走';
    trackLabel=first?(attack?'外並走・追撃可能':self?'後方待機':'位置取り・切替待ち'):
      following.status==='detached'?'追走離れ気味':following.status==='gap_opened'?'追走車間あり':'追走';
    entry=first?(attack?'主導権側を外から追撃':'先頭側を見ながら切替待ち'):following.basis+'。直前の車輪との追走状態で判定';
   }
   const spent=effort[n],remaining=clamp(.96-spent+endurance*.11,.07,.99),
       closing=clamp(.16+sprint*.33+abilityVal*.23+finish*.13+makuri*.09+remaining*.10);
   const reachable=gap<=2.4||attack&&gap<=4.05&&closing>=.49;
   states.push({no:n,name:r.name,line:lookup.get(n).group.members.slice(),lineIndex:originalIndex,riderStyle:r.style,role,track:trackLabel,entry,attack,followTarget:following?.followTarget??null,wheelGap:following?.wheelGap??null,trackingStrength:following?.tracking??null,followBasis:following?.basis??null,historyAssociation:following?.historyTop3Association??null,spent:round(spent),gap:round(gap),remaining:round(remaining),closing:round(closing),ability:round(abilityVal),finish:round(finish),speed:round(sprint),initiative:round(initiative(n)),reachable,atB:one?'先頭':gap<1.5?'直後':gap<3?'射程内':'後方'});
  }
 }
 states.sort((a,b)=>a.gap-b.gap||a.no-b.no);
 for(const s of states.filter(x=>x.track==='追走離れ気味'))passageEvents.push({actor:s.no,action:'detached',reason:s.no+'番は直前の'+s.followTarget+'番への追走に失敗するシナリオ（推定）'});
 for(const s of states.filter(x=>x.track==='追走車間あり'))passageEvents.push({actor:s.no,action:'gap_opened',reason:s.no+'番は直前の'+s.followTarget+'番と車間が開いたが、千切れではなく復帰・追走を維持できる状態'});
 for(const s of states.filter(x=>x.attack&&x.reachable))passageEvents.push({actor:s.no,action:'outside',reason:s.no+'番はBではまだ先頭でないが、外から追い上げを継続できる位置'});
 const backPositions=states.map((s,i)=>({no:s.no,ordinal:i,lane:s.attack?1:0,gap:s.gap,spent:s.spent,remaining:s.remaining}));
 scenes.push({id:'back',label:STAGES[3].label,leader:bNo,order:states.map(s=>s.no),lineOrder:orderedGroups.map(g=>g.members.slice()),positions:backPositions,events:passageEvents});
 const line=lookup.get(bNo).group.members.slice();
 const selected=states.find(s=>s.no===bNo);
 const scenario={
  bNo,tactic:mode,tacticLabel:tacticLabel||mode,line,leadingCost:selected.spent,
  pressure:round(pressure),topOpponents:rivals.slice(0,2).map(g=>g.head),states,phases:scenes,
  logic:[
   bNo+'番が最終バックを先頭で通過（この条件だけを固定）',
   tacticLabel+'でBを取得。初手・赤板・打鐘・ホームまでのライン間の反応と累積負担を計算',
   'Bラインの1〜3着は強制しない。外の反撃・番手差し・追走離れを分岐',
   '位置・脚の相対値は戦術推理であって計測値ではない'
  ],
  model:'six-phase-causal-v1'
 };
 const auditResult=audit(scenario);
 if(!auditResult.passed)throw Error('B-AXIS 位置・行動の整合性エラー: '+auditResult.failures.join(' / '));
 scenario.audit=auditResult;
 return scenario;
}
function complete(snapshot,tickets){
 const stages=snapshot.phases.slice(0,4),back=stages[3],best=tickets?.[0];
 const byNo=new Map(snapshot.states.map(s=>[s.no,s]));
 function post(id,leader,order,events,charge){
  const rows=order.map((n,i)=>{const s=byNo.get(n),cost=Math.min(.89,s.spent+charge+(i<3?.045:0));return {no:n,ordinal:i,lane:id==='corner'&&s.attack?1:0,gap:round(i*.74),spent:round(cost),remaining:round(clamp(.96-cost+.1*s.remaining,.07,.99))};});
  return {id,label:STAGES.find(s=>s.id===id).label,leader,order,events,positions:rows,modelBasis:'本線買い目の決着経路に基づく仮説'};
 }
 if(!best){
  const unchanged=back.order.slice();
  stages.push(post('corner',snapshot.bNo,unchanged,[{actor:snapshot.bNo,action:'contest',reason:'最終Bから4角へ。決着候補は成立条件不足'}],.045));
  stages.push(post('finish',snapshot.bNo,unchanged,[{actor:snapshot.bNo,action:'finish',reason:'成立条件に合う三連単候補なし'}],.075));
  return stages;
 }
 const finish=best.trio,rest=back.order.filter(n=>!finish.includes(n)),last=finish.concat(rest);
 // Only promote the chosen winner if a finish route explicitly describes its path.
 const corner=['hold','marker','inside','third_rush','outside_marker','recovery'].includes(best.path)?back.order.slice():[finish[0],...back.order.filter(n=>n!==finish[0])];
 const attack=best.path==='outside'||best.path==='outside_marker',pass=best.path!=='hold';
 const reasons={
  hold:'最終Bの主導権を維持。番手と別線の仕掛けに耐えて直線に入る',
  marker:'B番手が前を見ながら最終3〜4角で差し構え',
  outside:'別線の自力がB後も外を踏み、3〜4角で捲り追い込む',
  outside_marker:'外を攻めた別線自力の後位が追走から抜け出す',
  third_rush:'Bライン3番手が内へ進路を取り、番手の牽制の隙を狙う',
  inside:'切替えた追込が空いた内進路に入る',
  recovery:'後位選手がBを取ったのち、元ライン先頭が切替え・踏み直しで直線勝負へ入る'
 };
 const cornerEvents=[{actor:finish[0],action:pass?'challenge':'retain',target:snapshot.bNo,reason:reasons[best.path]||'4角で直線の進路を選択'}];
 for(const n of finish.slice(1))cornerEvents.push({actor:n,action:'chase',reason:n+'番は最終Bの位置関係から3〜4角で上位進出を狙う'});
 const marked=(snapshot.interactions?.attackers||[]).filter(x=>x.blockable);
 const marker=snapshot.interactions?.defender?.connected?snapshot.states.find(x=>x.no===snapshot.interactions.defender.no):null;
 if(best.path==='third_rush'&&marker&&marked.length)cornerEvents.push({actor:marker.no,action:'block',target:marked[0].no,reason:marker.no+'番が外の'+marked[0].no+'番へ牽制可能な位置にあり、B側3番手が内へ進路を得る仮説'});
 if(best.path==='outside'&&marker&&marked.some(x=>x.no===finish[0]))cornerEvents.push({actor:marker.no,action:'block_failed',target:finish[0],reason:marker.no+'番が'+finish[0]+'番を牽制できる位置にいたが、この決着分岐では止め切れない'});
 if(best.path==='marker'&&marked.length&&marker)cornerEvents.push({actor:marker.no,action:'block',target:marked[0].no,reason:marker.no+'番が'+marked[0].no+'番への牽制を選び、直線の差しへ移る仮説'});
 if(attack)cornerEvents.push({actor:snapshot.bNo,action:'respond',target:finish[0],reason:'B選手は別線の反撃に対応。B通過時の消耗・追走関係を引き継ぐ'});
 const cornerPhase=post('corner',corner[0],corner,cornerEvents,.055);
 const finalEvents=[{actor:finish[0],action:'finish',target:snapshot.bNo,reason:'本線三連単'+best.key+'。'+(best.reason||'B後の決着経路を比較')}];
 for(const n of finish.slice(1))finalEvents.push({actor:n,action:'place',reason:n+'番が直線で着位を争い、上位'+(finish.indexOf(n)+1)+'着を確保する展開'});
 const finishPhase=post('finish',finish[0],last,finalEvents,.125);
 const result=stages.concat([cornerPhase,finishPhase]),check=audit({...snapshot,phases:result},{complete:true});
 if(!check.passed)throw Error('B-AXIS 終盤局面監査: '+check.failures.join(' / '));
 return result;
}
function audit(snap,opts={}){
 const failures=[],phases=snap?.phases||[],ids=snap.states.map(x=>x.no).sort((a,b)=>a-b),b=snap.bNo;
 const setEq=rows=>rows.length===ids.length&&rows.slice().sort((a,b)=>a-b).every((n,i)=>n===ids[i]);
 if(![4,6].includes(phases.length))failures.push('局面数に欠損あり');
 const before=new Map();
 phases.forEach((phase,i)=>{
  if(!setEq(phase.order)||!setEq(phase.positions.map(p=>p.no)))failures.push(phase.id+' 全選手の位置が一致しない');
  if(new Set(phase.positions.map(p=>p.no)).size!==ids.length)failures.push(phase.id+' 選手が重複');
  if(!Array.isArray(phase.events)||!phase.events.length)failures.push(phase.id+' 戦術的な理由がない');
  for(const p of phase.positions){
   if(!Number.isFinite(p.spent)||!Number.isFinite(p.gap)||p.gap<0||p.spent<0||p.spent>1)failures.push(phase.id+' 状態値が不正');
   if(before.has(p.no)&&p.spent+.001<before.get(p.no))failures.push(phase.id+' 脚の消耗が逆行');
   before.set(p.no,p.spent);
  }
  if(i>0&&i<=3&&phases[i-1].lineOrder&&phase.lineOrder){
   const sign=l=>l.slice().sort((a,b)=>a-b).join(',');
   const previous=phases[i-1].lineOrder.map(sign),current=phase.lineOrder.map(sign);
   for(const id of previous){
    const movement=Math.abs(previous.indexOf(id)-current.indexOf(id));
    if(movement>2)failures.push(phase.id+'：1局面でラインが3つ以上飛び越える');
   }
  }
  if(i===3){
   if(phase.leader!==b||phase.positions.find(p=>p.no===b)?.gap!==0)failures.push('B時点の先頭が指定Bと不一致');
   if(phases[2]?.leader!==b&&phase.events.every(e=>!['pass','reorder'].includes(e.action)))failures.push('ホームからBの主導権交替に原因がない');
  }
 });
 return {passed:failures.length===0,failures:[...new Set(failures)],checks:['全選手の保存','6局面と戦術イベント','ホーム〜Bの主導権交替','累積脚消耗の単調性','B先頭条件'],relative:true};
}
const api={STAGES,value,simulate,complete,audit,Follow};if(typeof module!=='undefined')module.exports=api;
root.BAxisPhases=api;
})(typeof globalThis!=='undefined'?globalThis:this);
