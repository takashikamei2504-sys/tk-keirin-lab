/* Sequential relative-mass scenario engine. All movement/energy rules are uncalibrated assumptions. */
(function(root){'use strict';
const legacy=typeof module!=='undefined'?require('./race-brain.js'):root.RaceBrain;
const weights=typeof module!=='undefined'?require('./branch-weights.js'):root.BranchWeights;
const memoryAPI=typeof module!=='undefined'?require('./brain-memory.js'):root.BrainMemory;
const VERSION='sequential-causal-v2.0.0';
const MODES={...legacy.MODES,wait:'仕掛けを待って直線勝負'};
const clip=(x,a=.04,b=.96)=>Math.max(a,Math.min(b,x));
const phases=['周回','打鐘','最終ホーム','最終バック','直線'];
const labels={resist:'突っ張り',yield:'引いて温存',kamashi:'カマシ',makuri:'捲り',wait:'待機',holds:'追走維持',breaks:'追走離れ',lead:'押し切り',sashi:'番手差し',seat:'番手利用',recovery:'再仕掛け',counter:'捲り返し',thirdline:'第三ラインの仕掛け',switch:'切替',thirdsprint:'3番手の追込み',solo:'単騎の追上げ',outer:'大外への仕掛け'};
const clone=s=>({...s,order:[...s.order],energy:{...s.energy},events:[...s.events],decisions:[...s.decisions],snapshots:[...s.snapshots]});
function validate(r){
 const ids=r?.riders?.map(x=>x.no)||[],flat=r?.lineup?.flat()||[];
 if(![7,9].includes(ids.length)||new Set(ids).size!==ids.length||ids.some(n=>!Number.isInteger(n)||n<1||n>9)||
  flat.length!==ids.length||new Set(flat).size!==ids.length||flat.some(n=>!ids.includes(n))||r.lineup.some(l=>!l.length)||
  r.riders.some(x=>!Number.isFinite(x.score))||!Number.isFinite(memoryAPI.cutoffOf(r)))throw Error('発走日時・得点と7車／9車の完全な並びを確認してください');
 if(r.lineup.length<2)throw Error('独立した別線が必要です');
 return ids.slice().sort((a,b)=>a-b);
}
function snapshot(s,phase,action){return {phase,order:[...s.order],energy:{...s.energy},action};}
function advance(s,ids,target,phase,reason){
 // Adjacent crossings are explicit; the engine never silently teleports a rider.
 const moving=s.order.filter(n=>ids.includes(n)),rest=s.order.filter(n=>!ids.includes(n));
 const destination=Math.max(0,Math.min(target,rest.length));
 const desired=[...rest.slice(0,destination),...moving,...rest.slice(destination)];
 for(let i=0;i<desired.length;i++){
  let j=s.order.indexOf(desired[i]);
  while(j>i){
   [s.order[j-1],s.order[j]]=[s.order[j],s.order[j-1]];j--;
   s.events.push({phase,kind:'adjacent_crossing',order:[...s.order],reason,feasibility:'unknown'});
  }
 }
}
function route(s,no,r,stage){
 const known=r.conditions?.routes?.[no]?.[stage];
 if(known==='blocked')return {feasibility:'blocked',reason:'既知の進路閉塞'};
 return {feasibility:'unknown',reason:'進路・速度・車間は未計測。位置と局面による仮説'};
}
function context(s,no,r){
 const line=r.lineup.find(l=>l.includes(no)),index=s.order.indexOf(no);
 return {phase:s.phase,position:index+1,role:line[0]===no?'leader':'follower',energy:s.energy[no],
  pressure:s.stand==='resist'?'contested':'settled',lineLength:line.length};
}
function build(r,pack={},options={}){
 const ids=validate(r),by=new Map(r.riders.map(x=>[x.no,x])),leaders=r.lineup.map(l=>l[0]);
 const lineOf=new Map();r.lineup.forEach(l=>l.forEach(n=>lineOf.set(n,l)));
 const priors=legacy.profiles(r,{}),memories=memoryAPI.build(r,pack);
 const p=(n,k,s)=>memoryAPI.trait(priors.get(n)[k],memories,n,k,context(s,n,r));
 const ability=n=>clip(.55+(by.get(n).score-100)*.025,.2,1.25);
 const profiles=Object.fromEntries(ids.map(n=>{const q={...priors.get(n),evidence:memories.filter(m=>m.no===n&&m.numeric),memory:memories.filter(m=>m.no===n)};
  if(q.evidence.length)q.basis=`公開記事本文${new Set(q.evidence.map(m=>m.url)).size}件。局面条件を照合`;
  return [n,q];}));
 const width=options.width??8192;
 if(!Number.isInteger(width)||width<8||width>16384)throw Error('探索幅は8〜16384で指定してください');
 let unresolved=0,nodeNumber=0;
 const decisionNodes=new Map();
 const initial={phase:'周回',order:r.lineup.flat(),energy:Object.fromEntries(ids.map(n=>[n,0])),mass:1,events:[],decisions:[],snapshots:[],front:null,attacker:null,stand:'yield',tactic:'wait',outcome:'front-holds',gap:'solo',seat:null,leader:null};
 // One normalization boundary per decision, reaction or result; duplicates cannot add mass.
 function fork(states,kind,candidates,apply){
  const out=[];
  for(const state of states){
   const choices=candidates(state),allocation=weights.allocate(state.mass,choices);
   unresolved+=allocation.unresolvedMass;
   const lookup=new Map(choices.map(c=>[c.key,c]));
   const nodeId=++nodeNumber;
   if(allocation.branches.length>1&&choices.some(c=>c.decision)&&new Set(choices.filter(c=>c.feasibility!=='blocked').map(c=>c.actor)).size===1)decisionNodes.set(nodeId,{kind,actor:choices.find(c=>c.decision).actor,parentMass:state.mass,choices:allocation.branches.map(x=>({key:x.key,mass:x.mass})),context:context(state,choices.find(c=>c.decision).actor,r)});
   for(const b of allocation.branches){
    const choice=lookup.get(b.key),s=clone(state);s.mass=b.mass;
    if(choice.decision)s.decisions.push({nodeId,key:b.key,actor:choice.actor,action:choice.action||choice.key,kind,context:context(state,choice.actor,r),traits:Object.fromEntries(['resist','withdraw','kamashi','makuri','track','finish'].map(k=>[k,p(choice.actor,k,state)])),basis:choice.basis||'脚質・位置・消耗による暫定ルール'});
    apply(s,choice);
    out.push(s);
   }
  }
  out.sort((a,b)=>b.mass-a.mass||JSON.stringify(a.order).localeCompare(JSON.stringify(b.order)));
  if(out.length>width){unresolved+=out.slice(width).reduce((sum,s)=>sum+s.mass,0);out.length=width;}
  return out;
 }
 const c=(key,actor,weight,extra={})=>({key,actor,action:key,weight:Math.max(.001,weight),feasibility:'allowed',...extra});
 let states=fork([initial],'front',s=>leaders.map(n=>c(String(n),n,.1+p(n,'front',s))), (s,c)=>{
  s.front=Number(c.key);s.leader=s.front;
  const rest=r.lineup.filter(l=>l[0]!==s.front).sort((a,b)=>p(b[0],'front',s)-p(a[0],'front',s)||a[0]-b[0]);
  s.order=[...lineOf.get(s.front),...rest.flat()];s.snapshots.push(snapshot(s,'周回',`${s.front}番が前受け。並び内の順序を維持`));
 });
 states=fork(states,'attack',s=>{
  const candidates=[c('wait',s.front,.22,{decision:true,basis:'他線は動かず前受け側がペースを作る'})];
  for(const n of leaders.filter(n=>n!==s.front)){
   const pos=s.order.indexOf(n)/ids.length;
   for(const tactic of ['kamashi','makuri'])candidates.push(c(`${n}:${tactic}`,n,p(n,tactic,s)*(1-.25*pos)*(1-s.energy[n]),{decision:true,action:tactic,...route(s,n,r,'attack'),basis:`${s.order.indexOf(n)+1}番手・${lineOf.get(n).length}車ラインから仕掛け機会を比較`}));
  }return candidates;
 },(s,c)=>{if(c.key!=='wait'){[s.attacker,s.tactic]=c.key.split(':');s.attacker=Number(s.attacker);}s.phase='打鐘';});
 states=fork(states,'stand',s=>s.attacker?[
  c('resist',s.front,p(s.front,'resist',s)*(1-s.energy[s.front])*(1+.16*(lineOf.get(s.front).length-1))*(s.tactic==='kamashi'?1.15:.8),{decision:true}),
  c('yield',s.front,p(s.front,'withdraw',s)*(s.tactic==='kamashi'?1.1:1.3),{decision:true})
 ]:[c('yield',s.front,1)],(s,c)=>{
  s.stand=c.key;s.energy[s.front]+=s.attacker?(c.key==='resist'?.27:.06):.12;
  if(s.attacker)s.energy[s.attacker]+=(s.tactic==='kamashi'?.24:.16)+s.order.indexOf(s.attacker)*.012;
  s.snapshots.push(snapshot(s,'打鐘',s.attacker?`${s.attacker}番が${labels[s.tactic]}を選択 → ${s.front}番は${labels[s.stand]}。ここでは主導権獲得を確定しない`:`他線が仕掛けを待ち、${s.front}番がペースを作る`));
 });
 states=fork(states,'takeover',s=>{
  if(!s.attacker)return [c('front-holds',s.front,1)];
  const success=clip(.5+.3*(ability(s.attacker)-ability(s.front))+.18*p(s.attacker,s.tactic,s)-(s.stand==='resist'?.23:0)-s.order.indexOf(s.attacker)*.012);
  return [c('attacker-takes',s.attacker,success),c('front-holds',s.front,1-success)];
 },(s,c)=>{
  s.outcome=c.key;s.leader=c.key==='attacker-takes'?s.attacker:s.front;
  if(s.leader===s.attacker)advance(s,lineOf.get(s.leader),0,'最終ホーム','打鐘からホームまでに外を進出する仮説');
  else if(s.attacker)s.energy[s.attacker]+=.13;
  s.phase='最終ホーム';
 });
 states=fork(states,'follow',s=>{
  const follower=lineOf.get(s.leader)[1];if(!follower)return [c('solo',s.leader,1)];
  const acceleration=s.leader===s.attacker&&s.tactic==='kamashi'?.23:.08;
  const keep=clip(.46+.43*p(follower,'track',s)-acceleration-(s.stand==='resist'?.07:0)+.1*(ability(follower)-ability(s.leader)));
  return [c('holds',follower,keep),c('breaks',follower,1-keep)];
 },(s,c)=>{
  s.gap=c.key;const follower=lineOf.get(s.leader)[1];
  if(c.key==='breaks'){
   const i=s.order.indexOf(follower),target=Math.min(s.order.length-1,i+2);
   advance(s,s.order.slice(i+1,target+1),i,'最終ホーム',`${follower}番が加速に対応できず後退する仮説`);s.energy[follower]+=.2;
  }
 });
 states=fork(states,'seat',s=>{
  if(s.gap!=='breaks')return [c('none',s.leader,1)];
  const ci=s.order.indexOf(s.leader),n=s.order.find((n,i)=>i>ci&&i<=ci+3&&!lineOf.get(s.leader).includes(n));
  return [c('none',s.leader,.5),...(n?[c(String(n),n,.2+p(n,'seat',s),{decision:true,action:'seat',...route(s,n,r,'seat'),basis:'空いた番手の近くにいる別線。進路は未計測'})]:[])];
 },(s,c)=>{
  if(c.key!=='none'){s.seat=Number(c.key);advance(s,[s.seat],s.order.indexOf(s.leader)+1,'最終ホーム','近い別線が空き番手へ進む仮説');s.energy[s.seat]+=.08;}
  s.snapshots.push(snapshot(s,'最終ホーム',`${s.leader}番が主導権。${s.gap==='breaks'?`${lineOf.get(s.leader)[1]}番が離れ、${s.seat?`${s.seat}番が番手を利用`:'番手の空きに即応する別線なし'}`:s.gap==='holds'?`${lineOf.get(s.leader)[1]}番が追走維持`:'単騎で先行'}`));
 });
 function lateCandidates(s){
  const cl=lineOf.get(s.leader),follower=cl[1],third=cl[2];
  const list=[c('lead:'+s.leader,s.leader,.35+ability(s.leader)*.4-s.energy[s.leader]*.25,{mode:'lead',finisher:s.leader,decision:true,action:'lead'})];
  const add=(mode,n,weight)=>{
   if(!n||s.order.indexOf(n)>4||s.energy[n]>.85)return;
   const isMove=!['sashi','thirdsprint'].includes(mode),availability=isMove?route(s,n,r,'late'):{feasibility:'allowed',reason:'追走位置を保ち直線を待つ'};
   list.push(c(mode+':'+n,n,weight,{mode,finisher:n,decision:true,action:mode,...availability,basis:`${s.order.indexOf(n)+1}番手・消耗${Math.round(s.energy[n]*100)}、前段${s.stand==='resist'?'踏み合い':'落ち着いた先行'}から比較`}));
  };
  if(s.gap==='holds'){add('sashi',follower,.25+p(follower,'finish',s)*.5);if(third)add('thirdsprint',third,.1+p(third,'finish',s)*.2);}
  if(s.seat)add('seat',s.seat,.15+p(s.seat,'seat',s)*.25+p(s.seat,'finish',s)*.2);
  if(s.gap==='breaks')for(const no of [follower,third].filter(Boolean))if(by.get(no).style!=='追')add('recovery',no,.05+p(no,'recover',s)*.2);
  if(s.stand==='yield'&&s.leader===s.attacker&&by.get(s.front).style!=='追')add('counter',s.front,.1+p(s.front,'makuri',s)*.25);
  if(s.stand==='resist')for(const n of leaders.filter(n=>n!==s.front&&n!==s.attacker&&by.get(n).style!=='追'))add('thirdline',n,.1+p(n,'makuri',s)*.22+s.energy[s.leader]*.15);
  if(s.attacker&&s.outcome==='front-holds')add('switch',lineOf.get(s.attacker)[1],.1);
  for(const l of r.lineup.filter(l=>l.length===1&&l[0]!==s.leader))add('solo',l[0],.1+p(l[0],'finish',s)*.15);
  // Multiple feasible rivals are considered, not a preselected strongest outsider.
  for(const n of s.order.filter(n=>!cl.includes(n)))add('outer',n,.05+p(n,'outer',s)*.14+s.energy[s.leader]*.12);
  return list;
 }
 states=fork(states,'late-decision',lateCandidates,(s,c)=>{
  s.attemptMode=c.mode;s.attemptRider=c.finisher;s.feasibilityReasons=[c.reason||'先行位置を維持'];
 });
 states=fork(states,'late-result',s=>{
  if(s.attemptMode==='lead')return [c('success',s.leader,1)];
  const no=s.attemptRider;
  const success=clip(.4+.25*(ability(no)-ability(s.leader))+.2*p(no,'finish',s)+s.energy[s.leader]*.18-s.energy[no]*.2-s.order.indexOf(no)*.025);
  return [c('success',no,success),c('failure',no,1-success)];
 },(s,c)=>{
  const no=s.attemptRider,move=!['lead','sashi','thirdsprint'].includes(s.attemptMode);
  if(move){
   const target=Math.max(1,s.order.indexOf(no)-(c.key==='success'?2:1));
   advance(s,[no],target,'最終バック',`${no}番の${labels[s.attemptMode]}、最大2位置までの進出を仮定`);s.energy[no]=Math.min(1,s.energy[no]+.18);
  }
  s.mode=c.key==='success'?s.attemptMode:'lead';s.first=c.key==='success'?no:s.leader;
  s.phase='最終バック';
  const action=`${no}番が${labels[s.attemptMode]}${s.attemptMode==='lead'?'を継続':c.key==='success'?'。進出・直線の伸びが届く分岐':'を試みるが届かず、先行側が残る分岐'}`;
  s.snapshots.push(snapshot(s,'最終バック',action));
 });
 const diagnostics={initialMass:1,terminalStates:states.length,explanationPolicy:'全決着を合算し、各買い目の説明経路は上位3件と別筋の代表を保持',terminalMass:states.reduce((sum,s)=>sum+s.mass,0),unresolvedMass:unresolved,width,
  rating:'相対的な仮説の重み。探索打切り分を再配分しない。的中確率ではない',kinematics:'進路・距離・速度・風は未計測。段階的な位置移動と消耗は暫定ルール'};
 if(Math.abs(diagnostics.terminalMass+unresolved-1)>1e-9)throw Error('分岐の重み保存に失敗しました');
 // Counterfactual comparison at identical pre-decision state. Descendant reactions are free to change.
 const impacts=new Map();
 for(const s of states)for(const d of s.decisions){
  if(!decisionNodes.has(d.nodeId))continue;
  if(!impacts.has(d.nodeId))impacts.set(d.nodeId,new Map());
  const group=impacts.get(d.nodeId);if(!group.has(d.key))group.set(d.key,{total:0,winners:new Map()});
  const v=group.get(d.key);v.total+=s.mass;v.winners.set(s.first,(v.winners.get(s.first)||0)+s.mass);
 }
 const pivots=[];
 for(const [nodeId,groups] of impacts){
  const node=decisionNodes.get(nodeId);if(node.choices.length!==2)continue;
  const [a,b]=node.choices.map(c=>groups.get(c.key));if(!a||!b)continue;
  const coverage=Math.min(a.total/node.choices[0].mass,b.total/node.choices[1].mass);
  if(coverage<.15)continue;
  const difference=ids.reduce((sum,n)=>sum+Math.abs((a.winners.get(n)||0)/a.total-(b.winners.get(n)||0)/b.total),0)/2;
  pivots.push({no:node.actor,name:by.get(node.actor).name,score:difference,matched_contexts:1,coverage:Math.min(1,coverage),
   decisions:[node.kind==='stand'?'突っ張るか／引くか':'局面別の判断',`同じ判断直前から反応を再生成。探索済み比率（両分岐の小さい方）${(coverage*100).toFixed(1)}%。的中確率ではない`]});
 }
 const best=new Map();for(const k of pivots)if(!best.has(k.no)||best.get(k.no).score<k.score)best.set(k.no,k);
 const keymen=[...best.values()].sort((a,b)=>b.score-a.score||a.no-b.no).slice(0,3);
 const ticketMap=new Map(),modeBest=new Map(),hypothesisMap=new Map();
 function distribute(items,score){return weights.allocate(1,items.map(n=>({key:String(n),weight:Math.exp(score(n)),feasibility:'allowed'}))).branches;}
 for(const s of states){
  const hypothesisId=[s.mode,s.front,s.attacker,s.stand,s.tactic,s.outcome,s.gap,s.first].join(':');
  if(!hypothesisMap.has(hypothesisId))hypothesisMap.set(hypothesisId,{id:hypothesisId,mode:s.mode,score:0,representative:null,paths:0});
  const hypothesis=hypothesisMap.get(hypothesisId);hypothesis.score+=s.mass;hypothesis.paths++;
  const rank=n=>ability(n)*.55+p(n,'finish',s)*.35-s.energy[n]*.3-s.order.indexOf(n)*.035;
  const seconds=distribute(ids.filter(n=>n!==s.first),n=>2.5*rank(n));
  for(const second of seconds){const two=Number(second.key);
   const thirds=distribute(ids.filter(n=>n!==s.first&&n!==two),n=>1.8*rank(n));
   for(const third of thirds){const three=Number(third.key),trio=[s.first,two,three],key=trio.join('-');
    const score=s.mass*second.mass*third.mass;
    if(!ticketMap.has(key))ticketMap.set(key,{key,trio,score:0,paths:[]});
    const t=ticketMap.get(key);t.score+=score;
    // Aggregate every finish; retain only three strongest explanatory paths per ticket.
    // This bounds exported memory without removing any score mass.
    const keepPath=t.paths.length<3||score>t.paths[2].score;
    const keepMode=!modeBest.has(s.mode)||score>modeBest.get(s.mode).score;
    const keepHypothesis=!hypothesis.representative||score>hypothesis.representative.score;
    if(!keepPath&&!keepMode&&!keepHypothesis)continue;
    const decisions=s.decisions.map(d=>({no:d.actor,name:by.get(d.actor).name,context:`${labels[d.action]||d.action}：${d.basis}`,basis:profiles[d.actor].basis,measurements:profiles[d.actor].measurements,
     article_sources:profiles[d.actor].evidence.map(e=>e.url)}));
    const finish=[...trio,...s.order.filter(n=>!trio.includes(n))];
    const snaps=[...s.snapshots,snapshot({...s,order:finish},'直線',`${key}の決着候補。直線の位置変化は到達を仮定した未計測の分岐`)];
    const n={pathId:[s.decisions.map(d=>d.nodeId+':'+d.key).join('|'),s.attemptMode,s.attemptRider,s.first].join('|'),mode:s.mode,front:s.front,attacker:s.attacker,stand:s.stand,tactic:s.tactic,outcome:s.outcome,leader:s.leader,gap:s.gap,seat:s.seat,first:s.first,second:two,third:three,trio,key,score,
     snapshots:snaps,states:snaps.map(x=>`${x.phase}：${x.action}【隊列 ${x.order.join('→')}】`),decisions,decisionTrace:s.decisions,
     movementTrace:s.events,feasibilityReasons:s.feasibilityReasons,weightBasis:'全節で兄弟分岐の重みを正規化。未解決量は別記',
     explanation:snaps.slice(1,4).map(x=>x.action).join(' → ')};
    if(keepPath){t.paths.push(n);t.paths.sort((a,b)=>b.score-a.score);t.paths.length=Math.min(3,t.paths.length);}
    if(keepMode)modeBest.set(s.mode,n);
    if(keepHypothesis)hypothesis.representative=n;
   }
  }
 }
 const narratives=[...new Set([...ticketMap.values()].flatMap(t=>t.paths).concat([...modeBest.values()]))];
 narratives.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
 const tickets=[...ticketMap.values()].sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
 for(const t of tickets)t.paths.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
 if(tickets.length<20)throw Error('成立条件から20点を生成できません。並び・進路条件を確認してください');
 const selected=tickets.slice(0,16).map(t=>({...t,supporting_path:t.paths[0],selection_reason:'展開分岐を正規化して合算した仮説スコア上位'}));
 const used=new Set(selected.map(t=>t.key)),modes=new Set(selected.map(t=>t.supporting_path.mode));
 for(const n of narratives){if(selected.length===20)break;if(modes.has(n.mode)||used.has(n.key))continue;
  selected.push({...ticketMap.get(n.key),paths:[n,...ticketMap.get(n.key).paths.filter(p=>p!==n)].slice(0,3),supporting_path:n,selection_reason:MODES[n.mode]+'の別筋を仮説スコア順で採用'});used.add(n.key);modes.add(n.mode);}
 for(const t of tickets){if(selected.length===20)break;if(!used.has(t.key)){selected.push({...t,supporting_path:t.paths[0],selection_reason:'未採用候補を仮説スコア順で補完'});used.add(t.key);}}
 const hypotheses=[...hypothesisMap.values()].sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,6);
 return {version:VERSION,race:{date:r.date,venue:r.venue,race_no:r.race_no,start:r.start},profiles,missing:r.riders.some(x=>x.meta?.absent_fields?.length)||!!r.source?.missing_fields?.length,
  narratives,hypotheses,tickets,chosen:selected,keymen,front:states[0].front,dataSource:r.source?.label||'入力出走表',diagnostics,
  intelligence:{generated_at:pack.generated_at||null,evidence_count:memories.filter(m=>m.numeric).length,memory_count:memories.length,cutoff_policy:'published_at AND collected_at < race start (JST)'},rating:'未校正の逐次判断・相対仮説スコア（的中確率ではありません）'};
}
const api={VERSION,MODES,build,profiles:legacy.profiles,context,route,validate};
if(typeof module!=='undefined')module.exports=api;
root.RaceBrainV1=legacy;root.RaceBrain=api;
})(typeof globalThis!=='undefined'?globalThis:this);
