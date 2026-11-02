/* Story first: choose a coherent six-stage race, then derive 6 main + 4 alternative tickets. */
(function(root){'use strict';
const Legacy=typeof module!=='undefined'?require('./race-brain.js'):root.RaceBrainV1||root.RaceBrain;
const Memory=typeof module!=='undefined'?require('./brain-memory.js'):root.BrainMemory;
const Context=typeof module!=='undefined'?require('./rider-context.js'):root.RiderContext;
const Weights=typeof module!=='undefined'?require('./branch-weights.js'):root.BranchWeights;
const Reasons=typeof module!=='undefined'?require('./decision-reasons.js'):root.DecisionReasons;
const Deliberation=typeof module!=='undefined'?require('./tactical-deliberation.js'):root.TacticalDeliberation;
const CrossLine=typeof module!=='undefined'?require('./cross-line-tactics.js'):root.CrossLineTactics;
const Reality=typeof module!=='undefined'?require('./race-reality.js'):root.RaceReality;
const Reactions=typeof module!=='undefined'?require('./line-reactions.js'):root.LineReactions;
const Provenance=typeof module!=='undefined'?require('./model-provenance.js'):root.ModelProvenance;
const Build=typeof module!=='undefined'?require('./model-build.js'):root.ModelBuild;
const Search=typeof module!=='undefined'?require('./search-policy.js'):root.TacticalSearch;
const Finish=typeof module!=='undefined'?require('./finish-review.js'):root.FinishReview;
const VERSION='story-first-v5.3.0',STAGES=['並び確認・S取り','赤板周回～打鐘','最終ホーム','最終バック','最終3～4コーナー','最後の直線'];
const MODES={lead:'逃げ粘り',sashi:'番手差し',makuri:'捲り',outer:'大外強襲',split:'3番手の中割り',inside:'後続のイン突き',vertical:'縦踏み',block:'番手のブロック',recover:'離れから立て直し',thirdsprint:'3番手の追込み'};
const clip=(v,a=.04,b=.96)=>Math.min(b,Math.max(a,v));
function validate(r){const ids=r?.riders?.map(x=>x.no)||[],flat=r?.lineup?.flat()||[];
 if(![7,9].includes(ids.length)||new Set(ids).size!==ids.length||ids.some(n=>!Number.isInteger(n)||n<1||n>9)||flat.length!==ids.length||new Set(flat).size!==ids.length||flat.some(n=>!ids.includes(n))||r.lineup.some(l=>!l.length)||r.riders.some(x=>!Number.isFinite(x.score))||!Number.isFinite(Memory.cutoffOf(r)))throw Error('発走日時・全選手の得点・重複のない想定並びが必要です');
 if(r.lineup.length<2)throw Error('別線のある並びが必要です');return ids.sort((a,b)=>a-b);}
function build(r,pack={},options={}){
 const ids=validate(r);if(r.race_material?.lineup_conflicts?.length)throw Error(r.race_material.lineup_conflicts.join('。')+'。並びの確認が必要です');const by=new Map(r.riders.map(x=>[x.no,x])),lineOf=new Map();r.lineup.forEach(l=>l.forEach(n=>lineOf.set(n,l)));
 const leaders=r.lineup.map(l=>l[0]),context=Context.build(r,pack),memories=Memory.build(r,pack),priors=Legacy.profiles(r,{}),width=options.width??256;
 if(!Number.isInteger(width)||width<16||width>2048)throw Error('探索幅は16～2048で指定してください');
 const who=n=>`${n}番${by.get(n).name}`,own=n=>by.get(n).style!=='追',ability=n=>clip(.55+(by.get(n).score-100)*.024,.2,1.3);
 const trait=(n,k,s)=>Memory.trait(priors.get(n)[k]??.5,memories,n,k,{phase:STAGES[s.stage||0],role:lineOf.get(n)[0]===n?'leader':'follower'});
 const controlLine=n=>lineOf.get(n).slice(lineOf.get(n).indexOf(n));
 const motivation=n=>context.lines.find(l=>l.leader===n)?.motivation||0;
 const reasons=Reasons.build(r,memories,context);
 const deliberation=Deliberation.build(r,context,{ability,trait});
 const crossLine=CrossLine.build(r,context,{ability,trait});
 const reactions=Reactions.build(r),finishReview=Finish.build(r,{ability,trait});
 let unresolved=0,serial=0,reconsidered=0;const searchTrace=[];const considered=new Set(),objections=new Map();
 const choose=(key,weight,extra={})=>({key,weight:Math.max(.001,weight),feasibility:'allowed',...extra});
 const initial={mass:1,analysisCost:0,auditFailures:0,outside:[],order:r.lineup.flat(),energy:Object.fromEntries(ids.map(n=>[n,0])),connected:Object.fromEntries(ids.map(n=>[n,true])),scenes:[],decisions:[],moves:[],stage:0};
 function state(s){return {...s,outside:[...s.outside],order:[...s.order],energy:{...s.energy},connected:{...s.connected},scenes:[...s.scenes],decisions:[...s.decisions],moves:[...s.moves],reactionLog:[...(s.reactionLog||[])],recovery:{...s.recovery}};}
 function move(s,moving,target,why){
  const group=s.order.filter(n=>moving.includes(n)),rest=s.order.filter(n=>!moving.includes(n)),at=Math.max(0,Math.min(target,rest.length)),desired=[...rest.slice(0,at),...group,...rest.slice(at)];
  for(let i=0;i<desired.length;i++){let j=s.order.indexOf(desired[i]);while(j>i){[s.order[j-1],s.order[j]]=[s.order[j],s.order[j-1]];j--;s.moves.push({stage:s.stage,order:[...s.order],reason:why,feasibility:'unknown'});}}
 }
 // Snapshot the connected travelling line. This only describes the selected
 // path; it does not add choices, probabilities, rank moves or ticket changes.
 function travellingLine(s,head,heads=[]){
  const members=[head];if(s.connected[head]===false)return members;
  const line=controlLine(head),prior=s.scenes.at(-1)?.tactical?.outside_groups||[];
  for(const next of line.slice(1)){
   const prev=members.at(-1),continued=prior.some(g=>g.members.includes(prev)&&g.members[g.members.indexOf(prev)+1]===next);
   if(s.connected[next]!==true||heads.includes(next)||next===s.leader||next===s.defender||next===s.seat||next===s.innerRider)break;
   if(s.order.indexOf(next)!==s.order.indexOf(prev)+1&&!(continued&&s.order.indexOf(next)>s.order.indexOf(prev)))break;
   members.push(next);
  }
  return members;
 }
 function addScene(s,index,text,shape='一本棒',actors=[]){
  const reasoning=index===5?reasons.finish(s,actors):reasons.scene(s.decisions.filter(d=>d.stage===index));
  const scrutiny=s.decisions.filter(d=>d.stage===index&&d.deliberation).map(d=>d.deliberation);reasoning.scrutiny=scrutiny;
  // Race prose states the selected action directly. Source limits, competing
  // decisions and unmeasured inputs live in the existing expandable reasoning.
  const fact=reasoning.facts.find(f=>(f.kind==='race_intention'||f.kind==='observed_action')&&
    !/未確認|未取得|出典未確認|発言末尾未収録/.test(f.label));
  const basis=fact&&!text.includes(fact.label)?fact.label+'。':'';
  const outsideHeads=index===4&&s.cornerRider?[...new Set([...s.outside,s.cornerRider])]:[...s.outside];
  const tactical={schema:'tk-keirin-scene-state/v1',leader:s.leader,front:s.front,starter:s.starter,
   attacker:s.attacker||null,tactic:s.tactic||null,stand:s.stand||null,outcome:s.outcome||null,
   homeRider:s.homeRider||null,homeResult:s.homeResult||null,backRider:s.backRider||null,backResult:s.backResult||null,
   gap:s.gap||null,defender:s.defender||null,seat:s.seat||null,outside:outsideHeads,outside_groups:outsideHeads.map(head=>({head,members:travellingLine(s,head,outsideHeads),basis:'connected-order'})),connected:{...s.connected},control_line:controlLine(s.leader),
   encounter:index===1&&s.attacker?{outside:s.attacker,front:s.front,tactic:s.tactic,stand:s.stand,leader:s.leader,attack_line:travellingLine(s,s.attacker),front_line:travellingLine(s,s.front)}:null,
   cornerRider:s.cornerRider||null,cornerOrigin:s.cornerOrigin||null,defense:s.defense||null,blockResult:s.blockResult||null,
   innerRider:s.innerRider||null,innerMode:s.innerMode||null,openInside:!!s.openInside,
   corner_order_before:s.cornerOrderBefore?[...s.cornerOrderBefore]:null,
   finish_from:index===5?[...s.order]:null,finish_order:index===5?[...actors.slice(0,3)]:null};
  const lineReactions=reactions.snapshot(s,index,s.scenes.at(-1));
  s.stage=index;s.scenes.push({stage:index+1,phase:STAGES[index],action:basis+text,order:[...s.order],energy:{...s.energy},shape,actors,reasoning,tactical,lineReactions,assumption:'位置・車間・速度は未計測の展開仮説'});
 }
 function branch(states,key,candidates,apply){const all=[];
  for(const s of states){const choices=candidates(s).map(c=>{const reasoning=reasons.evaluate(key,c,{...s,phase:STAGES[s.stage||0]});return {...c,weight:c.weight*reasoning.multiplier,reasoning};});
   const strategic=key==='red-attack'?crossLine.review(s,choices):null;
    if(strategic)for(const c of choices)c.weight*=strategic.assessments.get(c.key)?.multiplier??1;
    const phase={'home-attack':'home','back-attack':'back','corner-attack':'late'}[key],reviews=phase?deliberation.review(s,phase,choices).assessments:key==='defense'?deliberation.response(s,choices):null;
   if(reviews)for(const v of reviews.values())if(!v.passed){reconsidered++;if(v.objection)objections.set(v.phase+'|'+v.objection,{phase:v.phase,reason:v.objection});}
   if(['defense','inside'].includes(key))for(const c of choices.filter(c=>c.feasibility!=='blocked'))considered.add(c.key.split(':')[0]);const allocation=Weights.allocate(s.mass,choices),lookup=new Map(choices.map(c=>[c.key,c]));unresolved+=allocation.unresolvedMass;
   const topWeight=Math.max(...choices.filter(c=>c.feasibility!=='blocked').map(c=>c.weight));
   for(const b of allocation.branches){const c=lookup.get(b.key),next=state(s),review=reviews?.get(c.key);next.mass=b.mass;next.analysisCost+=(review?review.regret:Math.log(topWeight/c.weight)*.08)+(strategic?strategic.assessments.get(c.key).regret*.48:0);next.auditFailures+=review&&!review.passed?1:0;next.decisions.push({stage:s.stage,key,choice:c.key,actor:c.actor||null,basis:c.reasoning.basis,reasoning:c.reasoning,deliberation:review||null,strategic:strategic?.assessments.get(c.key)||null,alternatives:choices.filter(o=>o.key!==c.key).sort((a,b)=>b.weight-a.weight||a.key.localeCompare(b.key)).slice(0,3).map(o=>({label:o.reasoning.label,choice:o.key,actor:o.actor||null,feasibility:o.feasibility,basis:o.reasoning.basis}))});apply(next,c);all.push(next);}}
  const pruned=Search.retain(all,width,key);searchTrace.push(pruned.trace);unresolved+=pruned.droppedMass;return pruned.kept;
 }
 const available=(no,stage)=>r.conditions?.routes?.[no]?.[stage]==='blocked'?'blocked':'unknown';
 const attackers=(s,phase,maxPosition)=>ids.filter(n=>n!==s.leader&&n!==s.defender&&(lineOf.get(n)[0]!==lineOf.get(s.leader)[0]||s.connected[n]===false)&&own(n)&&(leaders.includes(n)||s.connected[n]===false)&&s.order.indexOf(n)>0&&s.order.indexOf(n)<=maxPosition&&s.energy[n]<.85).map(n=>{
   const opportunity=Reality.attackOpportunity(s,n,phase);
   return choose(String(n),.12+trait(n,'makuri',s)*.2,{actor:n,feasibility:opportunity.allowed?available(n,phase):'blocked',feasibilityReason:opportunity.reason});
 });
 const attackResult=(s,n)=>clip(.5+(ability(n)-ability(s.leader))*.65+(s.energy[s.leader]-s.energy[n])*.6-(s.frontResponse?.choice==='resist'&&s.frontResponse.actor===s.leader?.13:0),.15,.85);
 let states=branch([initial],'S',s=>ids.map(n=>choose(String(n),.1+trait(n,'front',s),{actor:n})),(s,c)=>{
  s.starter=Number(c.key);s.front=lineOf.get(s.starter)[0];s.leader=s.front;
  const others=r.lineup.filter(l=>l[0]!==s.front).sort((a,b)=>trait(b[0],'front',s)-trait(a[0],'front',s)||a[0]-b[0]);s.order=[...lineOf.get(s.front),...others.flat()];
  const measured=Number.isFinite(by.get(s.starter).s)&&!by.get(s.starter).meta?.absent_fields?.includes('s');
  addScene(s,0,`並びは${r.lineup.map(l=>l.join('-')).join('／')}。${who(s.starter)}がSを取り、${s.starter===s.front?'そのまま前受け':`${who(s.front)}を迎え入れて前受け`}。${measured&&by.get(s.starter).s_source?`直近4か月でS${by.get(s.starter).s}回の実績がある。`:''}初手は${s.order.join('→')}。`,'一本棒',[s.starter,s.front]);
 });
 // Different S-getters arriving at the same formation are one tactical state, not extra vote counts.
 const formations=new Map();for(const s of states){if(formations.has(s.front))formations.get(s.front).mass+=s.mass;else formations.set(s.front,s);}states=[...formations.values()];states.forEach(s=>s.stage=1);
 states=branch(states,'red-attack',s=>leaders.filter(n=>n!==s.front&&own(n)).flatMap(n=>['press','kamashi'].map(t=>choose(`${n}:${t}`,(.2+trait(n,t==='press'?'resist':'kamashi',s)+motivation(n))*(lineOf.get(n).length===1?.4:1.15)*(1-s.order.indexOf(n)*.025),{actor:n,feasibility:available(n,'attack')}))).concat(choose('wait',.12)),(s,c)=>{
  s.attacker=c.key==='wait'?null:Number(c.key.split(':')[0]);s.tactic=c.key==='wait'?'wait':c.key.split(':')[1];s.stage=1;
 });
 states=branch(states,'red-response',s=>s.attacker?[choose('resist',trait(s.front,'resist',s)+motivation(s.front),{actor:s.front}),choose('yield',trait(s.front,'withdraw',s),{actor:s.front})]:[choose('pace',1)],(s,c)=>{
  s.stand=c.key;s.energy[s.front]+=c.key==='resist'?.24:.05;
  if(s.attacker)s.energy[s.attacker]+=(s.tactic==='kamashi'?.22:.13);
 });
 states=branch(states,'red-result',s=>!s.attacker?[choose('front',1)]:s.stand==='yield'?[choose('take',1)]:[
  choose('front',.65+.2*(ability(s.front)-ability(s.attacker))),choose('take',.25+trait(s.attacker,'kamashi',s)*.3)],(s,c)=>{
  s.outcome=c.key==='take'?'attacker-takes':'front-holds';s.leader=c.key==='take'?s.attacker:s.front;
  if(s.leader===s.attacker)move(s,controlLine(s.leader),0,'赤板から打鐘で先頭へ進む仮説');else if(s.attacker)s.energy[s.attacker]+=.1;
  const actor=s.attacker?by.get(s.attacker):null,form=actor?.recent_form?.stats;
  const raceReason=actor?`${form?`${form.total}走でB${form.b}回という近況を踏まえ、`:''}${lineOf.get(actor.no).length>1?'後続を連れ出して好位置を確保したい':'単騎なので踏み合いを長引かせず位置を確保したい'}と読む。`:'';
  const reason=context.lines.find(l=>l.leader===(s.attacker||s.front));
  const relationship=reason?.facts.length?reason.facts.join('。')+'。':'';
  addScene(s,1,s.attacker?`${who(s.attacker)}が${s.tactic==='kamashi'?'カマシを狙って踏み上げる':'赤板から上昇して抑えに行く'}。${raceReason}${relationship}${who(s.front)}は${s.stand==='resist'?'突っ張って対抗する':'いったん出させ、引いて脚を残す'}。${s.outcome==='attacker-takes'?`${who(s.attacker)}が主導権を奪う`:`${who(s.front)}が抵抗して主導権を守る`}。`:`この筋では赤板で他線の早い仕掛けを置かず、${who(s.front)}がペースを作る。後方勢はホーム以降の仕掛けを待つ。`,s.stand==='resist'?'踏み合い':'一本棒',[s.front,s.attacker].filter(Boolean));
 });
 states=branch(states,'red-third',s=>{
   if(!s.attacker)return [choose('none',1)];
   const options=[choose('none',.85)];
   for(const c of reactions.counters(s)){
     if(r.conditions?.routes?.[c.no]?.red_counter==='blocked')continue;
     const incentive=trait(c.no,'makuri',s),positionValue=c.from<=6?.10:0;
     options.push(choose(String(c.no),Math.max(.04,.13+incentive*.12+positionValue),{actor:c.no,feasibility:'unknown'}));
   }
   return options;
 },(s,c)=>{
   if(c.actor)reactions.applyCounter(s,c.actor,move);
   // Branch states copy the scenes array but share its scene objects.
   // Copy the red scene before recording a branch-specific reaction.
   s.scenes[s.scenes.length-1]={...s.scenes.at(-1),tactical:{...s.scenes.at(-1).tactical}};
   const scene=s.scenes.at(-1);
   // The red-board resolution, including third-line reactions, belongs to
   // the same scene rather than being invented in the next stage.
   scene.action+=reactions.redClosing(s);
   scene.order=[...s.order];
   scene.energy={...s.energy};
   scene.lineReactions=reactions.snapshot(s,1,s.scenes.at(-2));
   scene.reasoning=reasons.scene(s.decisions.filter(d=>d.stage===1));
   scene.tactical.redThird=s.redThird||null;
   scene.tactical.redThirdAhead=s.redThirdAhead||null;
 });
 states.forEach(s=>s.stage=2);
 states=branch(states,'home-attack',s=>[choose('settle',.8),...attackers(s,'home',6)],(s,c)=>{
  s.homeRider=c.key==='settle'?null:Number(c.key);s.stage=2;
 });
 states=branch(states,'home-front-response',s=>!s.homeRider?[choose('pace',1)]:[choose('resist',Math.max(.1,.7-(s.energy[s.leader]||0)),{actor:s.leader}),choose('hold',.25+(s.energy[s.leader]||0)*.4,{actor:s.leader})],(s,c)=>{s.frontResponse={phase:'home',actor:s.leader,choice:c.key};if(s.homeRider)s.energy[s.leader]=Math.min(.95,s.energy[s.leader]+(c.key==='resist'?.065:.015));});
 states=branch(states,'home-result',s=>{if(!s.homeRider)return [choose('settled',1)];
  const gate=Reality.takeoverOpportunity(s,s.homeRider,'home'),p=attackResult(s,s.homeRider);
  return [choose('takes',p,{feasibility:gate.allowed?'unknown':'blocked',feasibilityReason:gate.reason}),choose('parallel',1-p)];
 },(s,c)=>{
  s.homeResult=c.key;const before=s.leader;
  if(s.homeRider){s.energy[s.homeRider]+=.25;s.energy[before]+=.09;if(c.key==='takes'){s.leader=s.homeRider;move(s,controlLine(s.leader).filter(n=>n===s.leader||s.connected[n]!==false),0,'ホームのロング捲りで隊列を入れ替える仮説');}else s.outside.push(s.homeRider);}
 });
 states=branch(states,'home-line-response',s=>reactions.laterOptions(s,'home').choices.map(c=>choose(c.key,c.weight,c)),(s,c)=>reactions.applyLater(s,c.actor||null,'home',move));
 states=branch(states,'follow',s=>{
  const f=controlLine(s.leader)[1];if(!f)return [choose('solo',1)];
  const keep=clip(.62+.32*trait(f,'track',s)-(s.homeRider||s.tactic==='kamashi'?.15:.04)-Math.max(0,ability(s.leader)-ability(f))*.35);return [choose('holds',keep),choose('breaks',1-keep)];
 },(s,c)=>{
  s.gap=c.key;const f=controlLine(s.leader)[1];
  if(c.key==='breaks'){const dropped=controlLine(s.leader).slice(1);dropped.forEach(n=>{s.connected[n]=false;s.energy[n]+=.18;});const at=s.order.indexOf(f);move(s,dropped,Math.min(at+2,ids.length-dropped.length),'踏み出しで番手以降が遅れる仮説');}
  const follow=f?`${who(f)}は${c.key==='holds'?'加速に合わせて追走を保つ':'踏み出しで離れる'}`:'先行側は単騎';
  addScene(s,2,`${s.homeRider?`${who(s.homeRider)}が最終ホームからロング捲り。${s.homeResult==='takes'?`${who(s.leader)}が前団をとらえる`:'先行側の抵抗で外に併走したまま'}。`:`${who(s.leader)}は仕掛け直される前にホームでペースを上げる。${s.gap==='breaks'?'加速で後ろとの間に切れ目ができる。':'隊列は一本棒に落ち着く。'}`}${follow}。`,s.homeResult==='parallel'?'併走':s.gap==='breaks'?'隊列に切れ目':'一本棒',[s.homeRider,s.leader,f].filter(Boolean));
  if(s.homeResult==='takes'){
    const additional=reactions.homeClosing(s,s.scenes.at(-2));
    if(additional)s.scenes.at(-1).action+=additional;
  }
 });
 states=individualFollow(states,'home',2);
 states.forEach(s=>s.stage=3);
 states=branch(states,'back-outside-resolution',s=>reactions.outsideOptions(s).map(c=>choose(c.key,c.weight,c)),(s,c)=>reactions.applyOutside(s,c,'back',move));
 states=branch(states,'back-seat',s=>{
  if(s.gap!=='breaks')return [choose('none',1)];const candidate=s.order.find((n,i)=>i>0&&i<=3&&!controlLine(s.leader).includes(n));
  return [choose('none',.55),...(candidate?[choose(String(candidate),.35+trait(candidate,'seat',s)*.2,{actor:candidate,feasibility:available(candidate,'seat')})]:[])];
 },(s,c)=>{
  s.seat=c.key==='none'?null:Number(c.key);if(s.seat)move(s,[s.seat],1,'空き番手へ近い別線が入る仮説');
  s.defender=s.seat||s.gap==='holds'&&controlLine(s.leader)[1]||null;s.stage=3;
 });
 // The back is a new decision point, not a photograph of the home formation.
 states=branch(states,'back-attack',s=>[choose('wait',.7),...attackers(s,'back',6)],(s,c)=>{s.backRider=c.actor||null;s.backLeaderBefore=s.leader;s.backLeadPositionBefore=s.backRider?s.order.indexOf(s.backRider)+1:null;s.backWasContinuing=!!(s.backRider&&s.outside.includes(s.backRider));s.stage=3;});
 states=branch(states,'back-front-response',s=>!s.backRider?[choose('pace',1)]:[choose('resist',Math.max(.1,.7-(s.energy[s.leader]||0)),{actor:s.leader}),choose('hold',.25+(s.energy[s.leader]||0)*.4,{actor:s.leader})],(s,c)=>{s.frontResponse={phase:'back',actor:s.leader,choice:c.key};if(s.backRider)s.energy[s.leader]=Math.min(.95,s.energy[s.leader]+(c.key==='resist'?.065:.015));});
 states=branch(states,'back-result',s=>{if(!s.backRider)return [choose('unchanged',1)];
  const gate=Reality.takeoverOpportunity(s,s.backRider,'back'),p=attackResult(s,s.backRider);
  return [choose('takes',p,{feasibility:gate.allowed?'unknown':'blocked',feasibilityReason:gate.reason}),choose('parallel',1-p)];
 },(s,c)=>{
  s.backResult=c.key;
  if(s.backRider){s.energy[s.backRider]+=.20;s.energy[s.leader]+=.10;
   if(c.key==='takes'){s.leader=s.backRider;s.seat=null;s.defender=null;s.gap=controlLine(s.leader)[1]?'unchecked':'solo';move(s,controlLine(s.leader).filter(n=>n===s.leader||s.connected[n]!==false),0,'バックからの反撃で主導権を取り直す仮説');s.outside=s.outside.filter(n=>n!==s.leader);}
   else if(!s.outside.includes(s.backRider))s.outside.push(s.backRider);
  }
 });
 states=branch(states,'back-line-response',s=>reactions.laterOptions(s,'back').choices.map(c=>choose(c.key,c.weight,c)),(s,c)=>reactions.applyLater(s,c.actor||null,'back',move));
 states=branch(states,'back-follow',s=>{
  if(s.gap!=='unchecked')return [choose('unchanged',1)];const f=controlLine(s.leader)[1];
  if(s.connected[f]===false)return [choose('breaks',1)];const keep=clip(.60+.32*trait(f,'track',s)-.12-Math.max(0,ability(s.leader)-ability(f))*.35);return [choose('holds',keep),choose('breaks',1-keep)];
 },(s,c)=>{
  if(c.key!=='unchanged'){s.gap=c.key;const f=controlLine(s.leader)[1];if(c.key==='breaks'){const dropped=controlLine(s.leader).slice(1);dropped.forEach(n=>{s.connected[n]=false;s.energy[n]+=.18;});const at=s.order.indexOf(f);move(s,dropped,Math.min(at+2,ids.length-dropped.length),'バックの再加速で番手以降が遅れる仮説');}}
  s.defender=s.seat||s.gap==='holds'&&controlLine(s.leader)[1]||null;
  const shape=s.outside.length?'併走・混戦':s.gap==='breaks'&&!s.seat?'隊列に切れ目':'一本棒';
  const counter=s.backRider?`${who(s.backRider)}が${s.homeRider===s.backRider?'ホームからの仕掛けを継続し':'バックから反撃し'}、${s.backResult==='takes'?'主導権を取り直す':'外で先頭に迫る'}。`:'別線から新しい仕掛けはなく、先行ラインがペースを握る。';
  addScene(s,3,counter+`${who(s.leader)}がバックを先頭で通過する。${s.outside.length?s.outside.map(who).join('・')+'が外に残り、前団は一本棒ではない':s.gap==='breaks'?'番手が離れ、隊列に切れ目ができる':s.defender?`${who(s.defender)}が追走し、前団は一本棒`:'先頭は単騎で、後ろは別線'}。${s.seat?`${who(s.seat)}が空いた番手へ入る。`:''}`,shape,[s.leader,s.defender,s.backRider].filter(Boolean));
 });
 states=individualFollow(states,'back',3);
 states.forEach(s=>s.stage=4);
 states=branch(states,'late-outside-resolution',s=>reactions.outsideOptions(s).map(c=>choose(c.key,c.weight,c)),(s,c)=>reactions.applyOutside(s,c,'late',move));
 states=branch(states,'corner-attack',s=>[choose('wait',.7),...attackers(s,'late',5)],(s,c)=>{
  s.cornerRider=c.actor||null;s.cornerEnergyBefore=s.cornerRider?s.energy[s.cornerRider]:null;s.cornerOrderBefore=[...s.order];s.cornerOrigin=s.cornerRider&&s.connected[s.cornerRider]===false?'recover':s.cornerRider&&s.order.indexOf(s.cornerRider)>=4?'outer':'makuri';s.stage=4;
 });
 states=branch(states,'defense',s=>s.defender?[
  choose('vertical',.1+trait(s.defender,'vertical',s)*.2+trait(s.defender,'finish',s)*.2),choose('follow',.65),...(s.cornerRider?[choose('block',.25+trait(s.defender,'block',s)*.45,{feasibility:s.order.indexOf(s.defender)===1&&s.order.indexOf(s.cornerRider)<=4?'unknown':'blocked'})]:[])
 ]:[choose('none',1)],(s,c)=>{s.defense=c.key;s.openInside=false;});
 states=branch(states,'block-result',s=>s.defense==='block'?[choose('stopped',clip(.45+trait(s.defender,'block',s)*.2+(ability(s.defender)-ability(s.cornerRider))*.3+(s.energy[s.cornerRider]-s.energy[s.defender])*.15)),choose('survives',1-clip(.45+trait(s.defender,'block',s)*.2+(ability(s.defender)-ability(s.cornerRider))*.3+(s.energy[s.cornerRider]-s.energy[s.defender])*.15))]:[choose('free',1)],(s,c)=>{
  s.blockResult=c.key;s.survivingAttack=c.key==='stopped'?null:s.cornerRider;
  if(s.cornerRider){s.energy[s.cornerRider]=Math.min(.95,s.energy[s.cornerRider]+.15);
    // Successful block means the attack is stopped; it must not advance a place.
    if(c.key!=='stopped'){const at=Math.max(1,s.order.indexOf(s.cornerRider)-1);move(s,[s.cornerRider],at,'止め切れない外の仕掛けが一車分前進する仮説');}
   }
  if(s.defense==='block')s.energy[s.defender]+=.1;
 });
 states=branch(states,'late-line-response',s=>reactions.laterOptions(s,'late').choices.map(c=>choose(c.key,c.weight,c)),(s,c)=>reactions.applyLater(s,c.actor||null,'late',move));
 states=branch(states,'inside-opening',s=>s.defense==='block'?[choose('opens',.45),choose('closed',.55)]:[choose('closed',1)],(s,c)=>{s.openInside=c.key==='opens';});
 states=branch(states,'inside',s=>{
  const options=[choose('none',.85)];if(!s.openInside)return options;
  const third=controlLine(s.leader)[2];
  if(third&&s.gap==='holds'&&s.connected[third]!==false&&s.order.indexOf(third)<=3)options.push(choose(`split:${third}`,.05+trait(third,'inside',s)*.15+trait(third,'finish',s)*.15,{actor:third,feasibility:available(third,'inside')}));
  for(const n of s.order.slice(2,5).filter(n=>n!==third&&n!==s.cornerRider&&n!==s.defender))options.push(choose(`inside:${n}`,.04+trait(n,'inside',s)*.12+trait(n,'finish',s)*.08,{actor:n,feasibility:available(n,'inside')}));
  return options;
 },(s,c)=>{
  s.innerRider=c.key==='none'?null:Number(c.key.split(':')[1]);s.innerMode=c.key.split(':')[0];
  const attempt=s.cornerRider?`${who(s.cornerRider)}が${s.cornerOrigin==='recover'?'離れた位置から踏み直して':s.cornerOrigin==='outer'?'大外を回して':'3コーナーから捲って'}迫る。`:'別線は仕掛けず、前団が直線勝負に入る。';
  const defense=s.defender?s.defense==='block'?`${who(s.defender)}は外へブロック。${s.blockResult==='stopped'?'仕掛けの勢いを止める':'仕掛けを止め切れない'}。${s.openInside?'横の仕事で内に空きができる':'内のコースは締めたまま直線へ向く'}。`:s.defense==='vertical'?`${s.cornerRider?`${who(s.defender)}は横へ牽制せず縦に踏み、外の仕掛けを止めるより自分の伸びを優先する`:`${who(s.defender)}は番手から踏み出し、先行の残り脚を見て差しを狙う`}。`:`${who(s.defender)}は番手を保ち、差しのタイミングを待つ。`:'番手は空いたまま、先行選手が外の動きに対応する。';
  const inner=s.innerRider?`${who(s.innerRider)}は${s.innerMode==='split'?'3番手から中割り':'後続からインを突く'}を狙う。開いたコースを使えることが成立条件。`:'後続は内を突かず、直線で踏み込む。';
  addScene(s,4,attempt+defense+inner+reactions.closing(s,'late'),s.openInside?'外の攻防・内に空き':s.cornerRider?'外からの仕掛け':'直線待ち',[s.cornerRider,s.defender,s.innerRider].filter(Boolean));
 });
 function individualFollow(states,phase,index){return branch(states,phase+'-individual-follow',s=>{
  const heads=[s.leader,...s.outside],candidates=[...new Set(heads.flatMap(head=>controlLine(head).slice(1)))].filter(n=>s.connected[n]!==false&&n!==s.leader&&n!==s.seat&&n!==s.defender);
  return [choose('holds',1),...candidates.map(no=>choose('drop:'+no,Math.max(.02,.22-trait(no,'track',s)*.18+(s.energy[no]||0)*.08),{actor:no}))];
 },(s,c)=>{let text='';if(c.actor){const line=controlLine(c.actor);for(const n of line){s.connected[n]=false;s.energy[n]=Math.min(.95,s.energy[n]+.12);}text=who(c.actor)+'は加速に付け切れず、後ろとの連結が切れる。';}
  const old=s.scenes.at(-1);s.scenes=s.scenes.slice(0,-1);addScene(s,index,old.action+text+reactions.closing(s,phase),c.actor?'隊列に切れ目':old.shape,old.actors);
 });}
 function finishes(s){
  const third=controlLine(s.leader)[2],heads=[s.leader,s.defender,s.survivingAttack,s.innerRider,third&&s.gap==='holds'&&s.connected[third]!==false&&s.order.indexOf(third)<=3?third:null].filter(Boolean);
  const unique=[...new Set(heads)];
  const review=finishReview.assess(s),rank=n=>review.rows.find(x=>x.no===n).score;
  const distribute=(arr,place)=>Weights.allocate(1,arr.filter(n=>Reality.finishingAccess(s,n,place).allowed).map(n=>choose(String(n),Math.exp(rank(n)*3)))).branches;
  const all=[];
  for(const first of distribute(unique,1))for(const second of distribute(ids.filter(n=>n!==Number(first.key)),2))for(const third of distribute(ids.filter(n=>n!==Number(first.key)&&n!==Number(second.key)),3)){
   const trio=[first,second,third].map(v=>Number(v.key)),winner=trio[0];
   const mode=winner===s.innerRider?s.innerMode:winner===s.survivingAttack?s.cornerOrigin:winner===s.defender?s.defense==='vertical'?'vertical':'sashi':winner===s.leader?'lead':'thirdsprint';
   all.push({key:trio.join('-'),trio,score:first.mass*second.mass*third.mass,mode});
  }
  return all.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
 }
 // Unexplainable transitions are not valid story candidates; preserve their
 // mass as unresolved instead of quietly renormalizing the remaining stories.
 const acceptedReality=states.filter(x=>Reality.audit(x,ids).passed);
 const excludedReality=states.length-acceptedReality.length;
 unresolved+=states.filter(x=>!Reality.audit(x,ids).passed).reduce((a,x)=>a+x.mass,0);
 states=acceptedReality;
 const diagnostics={lineReactionSchema:'tk-line-reactions/v1',openingStrategy:'cross-line-counterplay-v1',realityVersion:Reality.VERSION,realityExcluded:excludedReality,considered_corner_actions:[...considered],initialMass:1,terminalStates:states.length,terminalMass:states.reduce((a,s)=>a+s.mass,0),unresolvedMass:unresolved,width,kinematics:'隊列・進路・消耗は未校正の仮説。実際の車間・速度は未計測',reconsidered_choices:reconsidered,search_policy:'family-round-robin-v1',search_trace:searchTrace};
 if(Math.abs(diagnostics.terminalMass+unresolved-1)>1e-9)throw Error('展開分岐の重みが保存されていません');
 const signatureOf=s=>[s.front,s.attacker,s.tactic,s.stand,s.outcome,s.redThird||null,s.redThirdAhead||null,s.homeRider,s.homeResult,s.backRider,s.backResult,s.gap,s.seat,s.cornerRider,s.defense,s.blockResult,s.innerRider].join('|');
 // Decide the main complete tactical path before generating any finishing ticket.
 const reviewed=states.map(s=>{const audit=deliberation.audit(s);return {s,audit,whole:Search.assess(s,audit)};});
 const accepted=reviewed.filter(x=>x.whole.passed).sort((a,b)=>b.whole.score-a.whole.score||a.s.analysisCost-b.s.analysisCost||b.s.mass-a.s.mass||signatureOf(a.s).localeCompare(signatureOf(b.s)));
 if(!accepted.length)throw Error('別線の反撃・待機の検討を通過する本線が残りません。進路条件と出走情報の確認が必要です');
 const mainState=accepted[0].s;
 const compared=[...accepted.filter((x,i,a)=>i===0||a.findIndex(y=>y.whole.family===x.whole.family)===i).slice(0,24),...reviewed.filter(x=>!x.whole.passed).slice(0,4)].map(x=>({signature:signatureOf(x.s),family:x.whole.family,score:x.whole.score,components:x.whole.components,passed:x.whole.passed,objections:x.whole.objections,selected:x.s===mainState,reason:x.s===mainState?'反撃と待機の反証を通過し、全体の戦術評価が最上位':x.whole.passed?(['personality','counterplay','energy','following'].sort((a,b)=>(accepted[0].whole.components[b]-x.whole.components[b])-(accepted[0].whole.components[a]-x.whole.components[a])).map(k=>({personality:'選手の仕掛け・待機の整合性',counterplay:'他ラインへの応答',energy:'先行の残り脚',following:'ラインの追走'}[k]))[0]+'の比較を含む全体評価で本線を下回る'):'反証に未解決の矛盾がある'}));
 const selectionReview={method:'counterplay-before-tickets',policy:'whole-race-diverse-v1',compared,accepted:accepted.length,examined:states.length,reconsidered,rejected_objections:[...new Set([...objections.values()].map(x=>x.phase))].flatMap(phase=>[...objections.values()].filter(x=>x.phase===phase).slice(0,2)),audit:accepted[0].audit,scope:'ホーム・バック・3〜4角の仕掛け/待機と番手の応答を比較。車間・速度は未計測、係数は未校正'};
 const scenarios=states.map(s=>{const outcomes=finishes(s),top=outcomes[0],last=state(s);
  const conclusion=`直線は${who(top.trio[0])}が${MODES[top.mode]}で勝ち切る。${who(top.trio[1])}が２着、${who(top.trio[2])}が３着。${s.defense==='block'?(s.openInside?'番手の横の仕事で内の進路が開き、直線の伸びを比べる':'番手の横の仕事と、その後の脚色が決着を分ける'):s.survivingAttack?'外からの勢いと先行の残り脚がぶつかる':s.defender?'先行が使った脚と番手の余力が最後の差になる':'先行の残り脚と別線の追込みで決まる'}。`;
  const otherHeads=[...new Set(outcomes.slice(0,6).map(t=>t.trio[0]))].filter(n=>n!==top.trio[0]);
  const finish=finishReview.assess(s);finish.explanation=finishReview.explain(finish,top.trio);
  const closing=conclusion+finish.explanation+Reality.finishExplanation(s,top.trio,who);
  addScene(last,5,closing,'ゴール前',top.trio);last.scenes[5].order=[...top.trio,...s.order.filter(n=>!top.trio.includes(n))];
  last.scenes[5].lineReactions=reactions.snapshot({...s,order:last.scenes[5].order},5,last.scenes[4]);
  const id='story-'+(++serial),signature=signatureOf(s);
  return {id,signature,score:s.mass,first:top.trio[0],starter:s.starter,front:s.front,attacker:s.attacker,redThird:s.redThird||null,redThirdAhead:s.redThirdAhead||null,tactic:s.tactic,stand:s.stand,leader:s.leader,gap:s.gap,seat:s.seat,mode:top.mode,outcome:s.outcome,
   scenes:last.scenes,snapshots:last.scenes,states:last.scenes.map(x=>`${x.phase}：${x.action}【${x.shape}／隊列 ${x.order.join('→')}】`),decisions:s.decisions,movementTrace:s.moves,explanation:last.scenes.map(x=>x.action).join('\n'),
   title:`${who(s.leader)}の主導権から${MODES[top.mode]}`,finish_review:finish,outcomes,defender:s.defender,homeResult:s.homeResult,homeRider:s.homeRider,backRider:s.backRider,backResult:s.backResult,defense:s.defense,blockResult:s.blockResult,cornerRider:s.cornerRider,innerRider:s.innerRider,audit:deliberation.audit(s)};
 }).sort((a,b)=>b.score-a.score||a.signature.localeCompare(b.signature));
 // The main scenario is selected BEFORE looking at any finish-ticket ranking.
 const main=scenarios.find(s=>s.signature===signatureOf(mainState)),alternatives=[],signatures=new Set([main.signature]),categories=new Set();
 const turningPoints=[main.homeRider?`${who(main.homeRider)}がホームで仕掛け`:'ホームでは前団が隊列を保ち',main.backRider?`${who(main.backRider)}がバックで${main.backRider===main.homeRider?'踏み続け':'反撃し'}`:'バックでは前団が主導権を守り',main.cornerRider?`${who(main.cornerRider)}の最後の仕掛け${main.defender?'に番手が'+(main.defense==='block'?'ブロックで応じる':main.defense==='vertical'?'縦へ踏む':'直線勝負を選ぶ'):'が迫る'}`:'3〜4角から直線勝負へ進む'];
 main.reading=`私はこう読む。${who(main.leader)}が最終バックの主導権を握る。${turningPoints.join('、')}。最後は${who(main.first)}が${MODES[main.mode]}で勝ち、${who(main.outcomes[0].trio[1])}が２着。${main.finish_review.explanation}`;
 main.rationale='なぜなら、'+main.audit.reviews.filter(d=>d.phase_key).map(d=>`${d.phase}は${d.selected_reason}`).join('。')+'。';
 const difference=s=>s.front!==main.front?['S取り・初手',`${who(s.starter)}がSを取ると初手の位置関係が変わる`]:s.attacker!==main.attacker||s.redThird!==main.redThird||s.stand!==main.stand||s.tactic!==main.tactic?['赤板の攻防',`${s.attacker?who(s.attacker)+'の仕掛け':'赤板の待機'}と、前受け側の${s.stand==='resist'?'突っ張り':'対応'}${s.redThird?'、さらに'+who(s.redThird)+'の位置上昇':''}が変わる`]:s.homeRider!==main.homeRider||s.homeResult!==main.homeResult||s.gap!==main.gap?['ホームの仕掛け・追走','ホームのロング捲り、または追走の成否が変わる']:s.backRider!==main.backRider||s.backResult!==main.backResult?['バックの反撃','最終バックでの仕掛け直しと、その反撃への抵抗が変わる']:s.defense!==main.defense||s.innerRider!==main.innerRider?['3～4角の判断','横の仕事・縦踏み・内のコース選択が変わる']:['終盤の別筋','外からの仕掛けや番手の収まり方が変わる'];
 // The front-of-race causal path is one story. A minor placing may change
 // through the short straight's relative finishing speeds without inventing
 // a second major tactical attack or replacing the main story.
 const mainPodium=main.outcomes[0].trio,cornerOrder=main.scenes[4].order;
 const mainTicketReason=trio=>{
  const [first,second,third]=trio,front=cornerOrder.indexOf(third)+1;
  const thirdOption=third!==mainPodium[2];
  const leadPair=first===mainPodium[0]&&second===mainPodium[1];
  const reversedPair=first===mainPodium[1]&&second===mainPodium[0];
  const thirdText=thirdOption&&front>3?
   `。3着は${who(third)}が4角${front}番手から、直線の伸びと前団の脚色差で食い込む押さえ`:
   thirdOption?`。3着は${who(third)}の直線の伸びを押さえる`:'';
  if(leadPair)return '本線の1・2着を軸にする'+thirdText;
  if(reversedPair)return '先行の粘りと番手差しの1・2着逆転を押さえる'+thirdText;
  return '本線の主導権争いは維持し、直線の脚色差による着順の入れ替わりを押さえる'+thirdText;
 };
 const selected=main.outcomes.slice(0,6).map(t=>({...t,group:'main',supporting_path:main,paths:[main],selection_reason:mainTicketReason(t.trio)})),used=new Set(selected.map(t=>t.key));
 // Main story fixes the decisive contest, but allows short-straight placing
 // variance. A cover for third is NOT promoted into the main six-stage path.
 const thirdCovers=[...new Set(selected.map(t=>t.trio[2]))].filter(n=>n!==mainPodium[2]);
 main.third_place_coverage={
  anchor:mainPodium[2],
  options:thirdCovers.map(no=>({no,from:cornerOrder.indexOf(no)+1,
   reason:cornerOrder.indexOf(no)>=3?'直線の伸びと前団の脚色差で３着へ食い込む押さえ':'直線の脚色差による３着の押さえ'}))
 };

 function take(s){const t=s.outcomes.find(t=>!used.has(t.key));if(!t)return false;const [category,trigger]=difference(s);
  const last=s.scenes[5],finishState={order:s.scenes[4].order,defender:s.defender,defense:s.defense,survivingAttack:s.cornerRider&&s.blockResult!=='stopped'?s.cornerRider:null,innerRider:s.innerRider,outside:[]};
  const closing=`この別展開では${who(t.trio[0])}が${MODES[t.mode]}で勝ち切る。${who(t.trio[1])}が２着、${who(t.trio[2])}が３着。`+Reality.finishExplanation(finishState,t.trio,who);
  const scenes=[...s.scenes.slice(0,5),{...last,action:closing,reasoning:reasons.finish({order:s.scenes[4].order,energy:s.scenes[4].energy},t.trio),tactical:{...last.tactical,finish_from:[...s.scenes[4].order],finish_order:[...t.trio]},order:[...t.trio,...last.order.filter(n=>!t.trio.includes(n))],actors:t.trio,lineReactions:reactions.snapshot({...s,order:[...t.trio,...last.order.filter(n=>!t.trio.includes(n))]},5,s.scenes[4])}];
  const alternative={...s,first:t.trio[0],mode:t.mode,scenes,snapshots:scenes,states:scenes.map(x=>`${x.phase}：${x.action}【${x.shape}／隊列 ${x.order.join('→')}】`),explanation:scenes.map(x=>x.action).join('\n'),divergence:category,trigger,upset:t.trio[0]!==main.first};
  alternatives.push(alternative);signatures.add(s.signature);categories.add(category);
  selected.push({...t,group:'alternative',supporting_path:alternative,paths:[alternative],selection_reason:`${category}が変わる別筋：${trigger}`});used.add(t.key);return true;}

 for(const category of ['赤板の攻防','ホームの仕掛け・追走','3～4角の判断','S取り・初手']){
  const eligible=scenarios.filter(s=>!signatures.has(s.signature)&&difference(s)[0]===category);
  const preferred=alternatives.length===3&&!alternatives.some(s=>s.upset)?eligible.filter(s=>s.first!==main.first):eligible;
  for(const s of (preferred.length?preferred:eligible))if(take(s))break;
 }
 for(const s of scenarios){if(alternatives.length===4)break;if(!signatures.has(s.signature)&&!categories.has(difference(s)[0]))take(s);}
 for(const s of scenarios){if(alternatives.length===4)break;if(!signatures.has(s.signature))take(s);}
 if(selected.length!==10)throw Error('本線6点と別筋4点を成立条件から生成できません');
 const ticketMap=new Map();for(const s of scenarios)for(const t of s.outcomes){if(!ticketMap.has(t.key))ticketMap.set(t.key,{key:t.key,trio:t.trio,score:0});ticketMap.get(t.key).score+=s.score*t.score;}
 const tickets=[...ticketMap.values()].sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
 const profiles=Object.fromEntries(ids.map(n=>[n,{...priors.get(n),evidence:memories.filter(m=>m.no===n&&m.numeric),memory:memories.filter(m=>m.no===n)}]));
 const keymen=[...new Set([main.attacker,main.defender,main.homeRider,main.cornerRider,main.leader].filter(Boolean))].slice(0,3).map(no=>({no,name:by.get(no).name,decisions:[no===main.leader?'主導権と残り脚が本線の軸':'仕掛け・反応が本線と別筋の分かれ目'],score:0,matched_contexts:0}));
 return {version:VERSION,model:Build,reproducibility:Provenance.capture(r,pack,Build,width),race:{date:r.date,venue:r.venue,race_no:r.race_no,start:r.start},profiles,context,missing:context.missing.length>0,story:{main,alternatives,selection_review:selectionReview},selection_policy:{main:6,alternatives:4,total:10,method:'story-before-tickets'},chosen:selected,tickets,narratives:[main,...alternatives],hypotheses:[main,...alternatives].map(s=>({id:s.id,mode:s.mode,score:s.score,representative:s})),keymen,front:main.front,dataSource:r.source?.label||'参考サンプル',diagnostics,
  intelligence:{generated_at:pack.generated_at||null,evidence_count:memories.filter(m=>m.numeric).length,memory_count:memories.length,relationship_count:context.relationships.length,cutoff_policy:'公開・初回取得ともに発走前'},rating:'6段階をつなぐ展開仮説。的中確率ではありません'};
}
const api={VERSION,STAGES,MODES,build,validate,profiles:Legacy.profiles};if(typeof module!=='undefined')module.exports=api;root.RaceBrain=api;
})(typeof globalThis!=='undefined'?globalThis:this);
