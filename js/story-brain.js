/* Story first: choose a coherent six-stage race, then derive 6 main + 4 alternative tickets. */
(function(root){'use strict';
const Legacy=typeof module!=='undefined'?require('./race-brain.js'):root.RaceBrainV1||root.RaceBrain;
const Memory=typeof module!=='undefined'?require('./brain-memory.js'):root.BrainMemory;
const Context=typeof module!=='undefined'?require('./rider-context.js'):root.RiderContext;
const Weights=typeof module!=='undefined'?require('./branch-weights.js'):root.BranchWeights;
const VERSION='story-first-v3.0.0',STAGES=['並び確認・S取り','赤板周回～打鐘','最終ホーム','最終バック','最終3～4コーナー','最後の直線'];
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
 const motivation=n=>context.lines.find(l=>l.leader===n)?.motivation||0;
 let unresolved=0,serial=0;const considered=new Set();
 const choose=(key,weight,extra={})=>({key,weight:Math.max(.001,weight),feasibility:'allowed',...extra});
 const initial={mass:1,order:r.lineup.flat(),energy:Object.fromEntries(ids.map(n=>[n,0])),connected:Object.fromEntries(ids.map(n=>[n,true])),scenes:[],decisions:[],moves:[],stage:0};
 function state(s){return {...s,order:[...s.order],energy:{...s.energy},connected:{...s.connected},scenes:[...s.scenes],decisions:[...s.decisions],moves:[...s.moves]};}
 function move(s,moving,target,why){
  const group=s.order.filter(n=>moving.includes(n)),rest=s.order.filter(n=>!moving.includes(n)),at=Math.max(0,Math.min(target,rest.length)),desired=[...rest.slice(0,at),...group,...rest.slice(at)];
  for(let i=0;i<desired.length;i++){let j=s.order.indexOf(desired[i]);while(j>i){[s.order[j-1],s.order[j]]=[s.order[j],s.order[j-1]];j--;s.moves.push({stage:s.stage,order:[...s.order],reason:why,feasibility:'unknown'});}}
 }
 function addScene(s,index,text,shape='一本棒',actors=[]){s.stage=index;s.scenes.push({stage:index+1,phase:STAGES[index],action:text,order:[...s.order],energy:{...s.energy},shape,actors,assumption:'位置・車間・速度は未計測の展開仮説'});}
 function branch(states,key,candidates,apply){const all=[];
  for(const s of states){const choices=candidates(s);if(['defense','inside'].includes(key))for(const c of choices.filter(c=>c.feasibility!=='blocked'))considered.add(c.key.split(':')[0]);const allocation=Weights.allocate(s.mass,choices),lookup=new Map(choices.map(c=>[c.key,c]));unresolved+=allocation.unresolvedMass;
   for(const b of allocation.branches){const c=lookup.get(b.key),next=state(s);next.mass=b.mass;next.decisions.push({stage:s.stage,key,choice:c.key,actor:c.actor||null,basis:c.basis||'位置・脚質・近況を使う暫定判断'});apply(next,c);all.push(next);}}
  all.sort((a,b)=>b.mass-a.mass||JSON.stringify(a.decisions).localeCompare(JSON.stringify(b.decisions)));
  // Preserve a representative of each new decision before filling the beam by weight.
  const keep=[],seen=new Set();for(const s of all){const id=[s.front,s.attacker,s.stand,s.homeRider,s.gap,s.defense,s.innerRider,s.decisions.at(-1).choice].join('|');if(!seen.has(id)&&keep.length<width){seen.add(id);keep.push(s);}}
  for(const s of all)if(keep.length<width&&!keep.includes(s))keep.push(s);
  const retained=new Set(keep);unresolved+=all.filter(s=>!retained.has(s)).reduce((a,s)=>a+s.mass,0);return keep;
 }
 const available=(no,stage)=>r.conditions?.routes?.[no]?.[stage]==='blocked'?'blocked':'unknown';
 let states=branch([initial],'S',s=>ids.map(n=>choose(String(n),.1+trait(n,'front',s),{actor:n})),(s,c)=>{
  s.starter=Number(c.key);s.front=lineOf.get(s.starter)[0];s.leader=s.front;
  const others=r.lineup.filter(l=>l[0]!==s.front).sort((a,b)=>trait(b[0],'front',s)-trait(a[0],'front',s)||a[0]-b[0]);s.order=[...lineOf.get(s.front),...others.flat()];
  const measured=Number.isFinite(by.get(s.starter).s)&&!by.get(s.starter).meta?.absent_fields?.includes('s');
  addScene(s,0,`${context.lineup_status}は${r.lineup.map(l=>l.join('-')).join('／')}。${who(s.starter)}がSを取り${s.starter===s.front?'前受けを選ぶ':`${who(s.front)}を前へ迎え入れる`}と読む。初手は${s.order.join('→')}。${measured?by.get(s.starter).s_source?`公開出走表の直近4ヶ月S${by.get(s.starter).s}回を判断材料にする`:`入力S${by.get(s.starter).s}回を参考にする（出典の確かさは資料欄で確認）`:'Sの実測は未取得なので、前受け傾向とラインの役割からの暫定判断'}。`,'一本棒',[s.starter,s.front]);
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
  if(s.leader===s.attacker)move(s,lineOf.get(s.leader),0,'赤板から打鐘で先頭へ進む仮説');else if(s.attacker)s.energy[s.attacker]+=.1;
  const actor=s.attacker?by.get(s.attacker):null,form=actor?.recent_form?.stats;
  const raceReason=actor?`${form?`${form.total}走でB${form.b}回という近況を踏まえ、`:''}${lineOf.get(actor.no).length>1?'後続を連れ出して好位置を確保したい':'単騎なので踏み合いを長引かせず位置を確保したい'}と読む。`:'';
  const reason=context.lines.find(l=>l.leader===(s.attacker||s.front));
  addScene(s,1,s.attacker?`${who(s.attacker)}が${s.tactic==='kamashi'?'カマシで一気に叩く':'赤板から上昇して抑えに行く'}。${raceReason}${reason.facts.length?reason.facts.join('。')+'。'+reason.inference:''}${who(s.front)}は${s.stand==='resist'?'突っ張って主導権を守ろうとする':'いったん出させ、引いて脚を残す'}。ここでは${who(s.leader)}が前に立つ筋を選ぶ。`:`赤板では他線が様子を見て、${who(s.front)}がペースを作る。後方勢はホーム以降の仕掛けを待つ。`,s.stand==='resist'?'踏み合い':'一本棒',[s.front,s.attacker].filter(Boolean));
 });
 states.forEach(s=>s.stage=2);
 states=branch(states,'home-attack',s=>[choose('settle',.8),...leaders.filter(n=>n!==s.leader&&own(n)&&s.energy[n]<.4&&s.order.indexOf(n)<=6).map(n=>choose(String(n),.12+(trait(n,'makuri',s)+trait(n,'long_makuri',s))*.1+s.energy[s.leader]*.2,{actor:n,feasibility:available(n,'home')}))],(s,c)=>{
  s.homeRider=c.key==='settle'?null:Number(c.key);s.stage=2;
 });
 states=branch(states,'home-result',s=>!s.homeRider?[choose('settled',1)]:[choose('takes',.4+trait(s.homeRider,'makuri',s)*.25),choose('parallel',.5)],(s,c)=>{
  s.homeResult=c.key;const before=s.leader;
  if(s.homeRider){s.energy[s.homeRider]+=.25;s.energy[before]+=.09;if(c.key==='takes'){s.leader=s.homeRider;move(s,lineOf.get(s.leader),0,'ホームのロング捲りで隊列を入れ替える仮説');}}
 });
 states=branch(states,'follow',s=>{
  const f=lineOf.get(s.leader)[1];if(!f)return [choose('solo',1)];
  const keep=clip(.45+.4*trait(f,'track',s)-(s.homeRider||s.tactic==='kamashi'?.2:.06));return [choose('holds',keep),choose('breaks',1-keep)];
 },(s,c)=>{
  s.gap=c.key;const f=lineOf.get(s.leader)[1];
  if(c.key==='breaks'){s.connected[f]=false;s.energy[f]+=.18;const at=s.order.indexOf(f);move(s,s.order.slice(at+1,at+3),at,'踏み出しで番手が遅れる仮説');}
  const follow=f?`${who(f)}は${c.key==='holds'?'すんなり追走する筋':'踏み出しで離れる筋'}`:'先行側は単騎';
  addScene(s,2,`${s.homeRider?`${who(s.homeRider)}が最終ホームからロング捲り。${s.homeResult==='takes'?`${who(s.leader)}が前団をとらえる`:'先行側の抵抗で外に併走したまま'}。`:`${who(s.leader)}は仕掛け直される前にホームでペースを上げる。隊列は一本棒に落ち着く筋。`}${follow}。`,s.homeResult==='parallel'?'併走':'一本棒',[s.homeRider,s.leader,f].filter(Boolean));
 });
 states.forEach(s=>s.stage=3);
 states=branch(states,'back-seat',s=>{
  if(s.gap!=='breaks')return [choose('none',1)];const candidate=s.order.find((n,i)=>i>0&&i<=3&&!lineOf.get(s.leader).includes(n));
  return [choose('none',.55),...(candidate?[choose(String(candidate),.35+trait(candidate,'seat',s)*.2,{actor:candidate,feasibility:available(candidate,'seat')})]:[])];
 },(s,c)=>{
  s.seat=c.key==='none'?null:Number(c.key);if(s.seat)move(s,[s.seat],1,'空き番手へ近い別線が入る仮説');
  s.defender=s.seat||s.gap==='holds'&&lineOf.get(s.leader)[1]||null;s.stage=3;
  const shape=s.homeResult==='parallel'?'併走・混戦':s.gap==='breaks'&&!s.seat?'隊列に切れ目':'一本棒';
  addScene(s,3,`${who(s.leader)}が最終バックの主導権を取る。${shape==='一本棒'?s.defender?'前団は一本棒で、番手は脚をためられる':'前団は一本棒だが、先頭は単騎で別線の援護は見込まない':shape==='隊列に切れ目'?'番手の離れで隊列に切れ目ができる':`${who(s.homeRider)}が外に残り、一本棒には収まらない`}。${s.seat?`${who(s.seat)}は近い位置から空いた番手を利用する。`:''}ここまでの踏み合い${s.stand==='resist'?'で先行側の消耗が増え、後続の仕掛け時になる':'が短いぶん、先行側にも余力が残る'}。`,shape,[s.leader,s.defender].filter(Boolean));
 });
 states.forEach(s=>s.stage=4);
 states=branch(states,'corner-attack',s=>[choose('wait',.7),...ids.filter(n=>n!==s.leader&&n!==s.defender&&own(n)&&s.order.indexOf(n)>0&&s.order.indexOf(n)<=5&&s.energy[n]<.7).map(n=>choose(String(n),.09+trait(n,'makuri',s)*.15+s.energy[s.leader]*.18,{actor:n,feasibility:available(n,'late')}))],(s,c)=>{
  s.cornerRider=c.key==='wait'?s.homeResult==='parallel'&&available(s.homeRider,'late')!=='blocked'?s.homeRider:null:Number(c.key);s.cornerOrigin=s.cornerRider&&s.connected[s.cornerRider]===false?'recover':s.cornerRider&&s.order.indexOf(s.cornerRider)>=4?'outer':'makuri';s.stage=4;
 });
 states=branch(states,'defense',s=>s.defender?[
  choose('vertical',.1+trait(s.defender,'vertical',s)*.2+trait(s.defender,'finish',s)*.2),choose('follow',.65),...(s.cornerRider?[choose('block',.25+trait(s.defender,'block',s)*.45)]:[])
 ]:[choose('none',1)],(s,c)=>{s.defense=c.key;s.openInside=c.key==='block';});
 states=branch(states,'block-result',s=>s.defense==='block'?[choose('stopped',.45+trait(s.defender,'block',s)*.2),choose('survives',.4)]:[choose('free',1)],(s,c)=>{
  s.blockResult=c.key;s.survivingAttack=c.key==='stopped'?null:s.cornerRider;
  if(s.cornerRider){s.energy[s.cornerRider]=Math.min(.95,s.energy[s.cornerRider]+.15);const at=Math.max(1,s.order.indexOf(s.cornerRider)-1);move(s,[s.cornerRider],at,'コーナーで外を進む仮説');}
  if(s.defense==='block')s.energy[s.defender]+=.1;
 });
 states=branch(states,'inside',s=>{
  const options=[choose('none',.85)];if(!s.openInside)return options;
  const third=lineOf.get(s.leader)[2];
  if(third&&s.gap==='holds'&&s.order.indexOf(third)<=3)options.push(choose(`split:${third}`,.05+trait(third,'inside',s)*.15+trait(third,'finish',s)*.15,{actor:third,feasibility:available(third,'inside')}));
  for(const n of s.order.slice(2,5).filter(n=>n!==third&&n!==s.cornerRider&&n!==s.defender))options.push(choose(`inside:${n}`,.04+trait(n,'inside',s)*.12+trait(n,'finish',s)*.08,{actor:n,feasibility:available(n,'inside')}));
  return options;
 },(s,c)=>{
  s.innerRider=c.key==='none'?null:Number(c.key.split(':')[1]);s.innerMode=c.key.split(':')[0];
  const attempt=s.cornerRider?`${who(s.cornerRider)}が${s.cornerOrigin==='recover'?'離れた位置から踏み直して':s.cornerOrigin==='outer'?'大外を回して':'3コーナーから捲って'}迫る。`:`${leaders.filter(n=>n!==s.leader&&own(n)).slice(0,1).map(who).join('')||'後続'}は前の加速で仕掛け所が定まらず、動きが遅れる。前団の直線勝負になる。`;
  const defense=s.defender?s.defense==='block'?`${who(s.defender)}は外へブロック。${s.blockResult==='stopped'?'仕掛けの勢いを止める筋':'仕掛けを止め切れない筋'}で、そのぶん内に空きができる。`:s.defense==='vertical'?`${who(s.defender)}は横に振るより縦を踏む。${s.cornerRider?'外の仕掛けへの抵抗は薄くなるが、自分の伸びを優先する':'前の消耗を見て早めに踏み込む'}。`:`${who(s.defender)}は番手を保ち、差しのタイミングを待つ。`:'番手が空いているため、組織的なブロックは期待しない。';
  const inner=s.innerRider?`${who(s.innerRider)}は${s.innerMode==='split'?'3番手から中割り':'後続からインを突く'}を狙う。開いたコースを使えることが成立条件。`:'内のコースを使う選手がすぐに出ない筋。';
  addScene(s,4,attempt+defense+inner,s.openInside?'外の攻防・内に空き':s.cornerRider?'外からの仕掛け':'直線待ち',[s.cornerRider,s.defender,s.innerRider].filter(Boolean));
 });
 function finishes(s){
  const third=lineOf.get(s.leader)[2],heads=[s.leader,s.defender,s.survivingAttack,s.innerRider,third&&s.gap==='holds'&&s.order.indexOf(third)<=3?third:null].filter(Boolean);
  const unique=[...new Set(heads)];
  const rank=n=>ability(n)*.5+trait(n,'finish',{...s,stage:5})*.3-s.energy[n]*.38-s.order.indexOf(n)*.07+(n===s.innerRider?.13:0)+(n===s.survivingAttack?.12:0)+(n===s.defender&&s.defense==='vertical'?.15:0);
  const distribute=arr=>Weights.allocate(1,arr.map(n=>choose(String(n),Math.exp(rank(n)*3)))).branches;
  const all=[];
  for(const first of distribute(unique))for(const second of distribute(ids.filter(n=>n!==Number(first.key))))for(const third of distribute(ids.filter(n=>n!==Number(first.key)&&n!==Number(second.key)))){
   const trio=[first,second,third].map(v=>Number(v.key)),winner=trio[0];
   const mode=winner===s.innerRider?s.innerMode:winner===s.survivingAttack?s.cornerOrigin:winner===s.defender?s.defense==='vertical'?'vertical':'sashi':winner===s.leader?'lead':'thirdsprint';
   all.push({key:trio.join('-'),trio,score:first.mass*second.mass*third.mass,mode});
  }
  return all.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
 }
 const diagnostics={considered_corner_actions:[...considered],initialMass:1,terminalStates:states.length,terminalMass:states.reduce((a,s)=>a+s.mass,0),unresolvedMass:unresolved,width,kinematics:'隊列・進路・消耗は未校正の仮説。実際の車間・速度は未計測'};
 if(Math.abs(diagnostics.terminalMass+unresolved-1)>1e-9)throw Error('展開分岐の重みが保存されていません');
 const signatureOf=s=>[s.front,s.attacker,s.tactic,s.stand,s.outcome,s.homeRider,s.homeResult,s.gap,s.seat,s.cornerRider,s.defense,s.blockResult,s.innerRider].join('|');
 // Decide the main complete tactical path before generating any finishing ticket.
 const mainState=states.slice().sort((a,b)=>b.mass-a.mass||signatureOf(a).localeCompare(signatureOf(b)))[0];
 const scenarios=states.map(s=>{const outcomes=finishes(s),top=outcomes[0],last=state(s);
  const conclusion=`この流れなら${who(top.trio[0])}の${MODES[top.mode]}を本線に取る。${who(top.trio[1])}と${who(top.trio[2])}が相手の中心。${s.defense==='block'?'横の仕事で使った脚と、内にできたコースが最後の着順を分ける':s.survivingAttack?'外からの勢いと先行側の残り脚の比較になる':s.defender?'先行で使った脚と番手で残した脚の差が決め手になる':'先行の残り脚と別線の追込みの比較になる'}。`;
  const otherHeads=[...new Set(outcomes.slice(0,6).map(t=>t.trio[0]))].filter(n=>n!==top.trio[0]);
  const closing=conclusion+(otherHeads.length?`${otherHeads.map(who).join('・')}が先着する入れ替わりも、ここまで同じ流れから押さえる。`:'')+top.trio.slice(1).filter(n=>s.order.indexOf(n)>1).map(n=>`${who(n)}は${s.order.indexOf(n)+1}番手から温存した脚で直線を伸ばす。`).join('');
  addScene(last,5,closing,'ゴール前',top.trio);last.scenes[5].order=[...top.trio,...s.order.filter(n=>!top.trio.includes(n))];
  const id='story-'+(++serial),signature=signatureOf(s);
  return {id,signature,score:s.mass,first:top.trio[0],starter:s.starter,front:s.front,attacker:s.attacker,tactic:s.tactic,stand:s.stand,leader:s.leader,gap:s.gap,seat:s.seat,mode:top.mode,outcome:s.outcome,
   scenes:last.scenes,snapshots:last.scenes,states:last.scenes.map(x=>`${x.phase}：${x.action}【${x.shape}／隊列 ${x.order.join('→')}】`),decisions:s.decisions,movementTrace:s.moves,explanation:last.scenes.map(x=>x.action).join('\n'),
   title:`${who(s.leader)}の主導権から${MODES[top.mode]}`,outcomes,defender:s.defender,homeResult:s.homeResult,homeRider:s.homeRider,defense:s.defense,cornerRider:s.cornerRider,innerRider:s.innerRider};
 }).sort((a,b)=>b.score-a.score||a.signature.localeCompare(b.signature));
 // The main scenario is selected BEFORE looking at any finish-ticket ranking.
 const main=scenarios.find(s=>s.signature===signatureOf(mainState)),alternatives=[],signatures=new Set([main.signature]),categories=new Set();
 const difference=s=>s.front!==main.front?['S取り・初手',`${who(s.starter)}がSを取ると初手の位置関係が変わる`]:s.attacker!==main.attacker||s.stand!==main.stand||s.tactic!==main.tactic?['赤板の攻防',`${s.attacker?who(s.attacker)+'の仕掛け':'赤板の待機'}と、前受け側の${s.stand==='resist'?'突っ張り':'対応'}が変わる`]:s.homeRider!==main.homeRider||s.homeResult!==main.homeResult||s.gap!==main.gap?['ホームの仕掛け・追走','ホームのロング捲り、または追走の成否が変わる']:s.defense!==main.defense||s.innerRider!==main.innerRider?['3～4角の判断','横の仕事・縦踏み・内のコース選択が変わる']:['終盤の別筋','外からの仕掛けや番手の収まり方が変わる'];
 const selected=main.outcomes.slice(0,6).map(t=>({...t,group:'main',supporting_path:main,paths:[main],selection_reason:'一本の本線ストーリーから導く6点'})),used=new Set(selected.map(t=>t.key));
 function take(s){const t=s.outcomes.find(t=>!used.has(t.key));if(!t)return false;const [category,trigger]=difference(s);
  const last=s.scenes[5],closing=`この別筋では${who(t.trio[0])}の${MODES[t.mode]}を取り、${who(t.trio[1])}を2着、${who(t.trio[2])}を3着に選ぶ。`+t.trio.slice(1).map(n=>`${who(n)}は最終コーナーの${s.scenes[4].order.indexOf(n)+1}番手から直線を伸ばす筋。`).join('');
  const scenes=[...s.scenes.slice(0,5),{...last,action:closing,order:[...t.trio,...last.order.filter(n=>!t.trio.includes(n))],actors:t.trio}];
  const alternative={...s,first:t.trio[0],mode:t.mode,scenes,snapshots:scenes,states:scenes.map(x=>`${x.phase}：${x.action}【${x.shape}／隊列 ${x.order.join('→')}】`),explanation:scenes.map(x=>x.action).join('\n'),divergence:category,trigger,upset:t.trio[0]!==main.first};
  alternatives.push(alternative);signatures.add(s.signature);categories.add(category);
  selected.push({...t,group:'alternative',supporting_path:alternative,paths:[alternative],selection_reason:`${category}が変わる別筋：${trigger}`});used.add(t.key);return true;}

 for(const category of ['赤板の攻防','ホームの仕掛け・追走','3～4角の判断','S取り・初手']){
  const eligible=scenarios.filter(s=>!signatures.has(s.signature)&&difference(s)[0]===category);
  const preferred=alternatives.length===3&&!alternatives.some(s=>s.upset)?eligible.filter(s=>s.first!==main.first):eligible;
  for(const s of (preferred.length?preferred:eligible))if(take(s))break;
 }
 for(const s of scenarios){if(alternatives.length===4)break;if(!signatures.has(s.signature))take(s);}
 if(selected.length!==10)throw Error('本線6点と別筋4点を成立条件から生成できません');
 const ticketMap=new Map();for(const s of scenarios)for(const t of s.outcomes){if(!ticketMap.has(t.key))ticketMap.set(t.key,{key:t.key,trio:t.trio,score:0});ticketMap.get(t.key).score+=s.score*t.score;}
 const tickets=[...ticketMap.values()].sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
 const profiles=Object.fromEntries(ids.map(n=>[n,{...priors.get(n),evidence:memories.filter(m=>m.no===n&&m.numeric),memory:memories.filter(m=>m.no===n)}]));
 const keymen=[...new Set([main.attacker,main.defender,main.homeRider,main.cornerRider,main.leader].filter(Boolean))].slice(0,3).map(no=>({no,name:by.get(no).name,decisions:[no===main.leader?'主導権と残り脚が本線の軸':'仕掛け・反応が本線と別筋の分かれ目'],score:0,matched_contexts:0}));
 return {version:VERSION,race:{date:r.date,venue:r.venue,race_no:r.race_no,start:r.start},profiles,context,missing:context.missing.length>0,story:{main,alternatives},selection_policy:{main:6,alternatives:4,total:10,method:'story-before-tickets'},chosen:selected,tickets,narratives:[main,...alternatives],hypotheses:[main,...alternatives].map(s=>({id:s.id,mode:s.mode,score:s.score,representative:s})),keymen,front:main.front,dataSource:r.source?.label||'参考サンプル',diagnostics,
  intelligence:{generated_at:pack.generated_at||null,evidence_count:memories.filter(m=>m.numeric).length,memory_count:memories.length,relationship_count:context.relationships.length,cutoff_policy:'公開・初回取得ともに発走前'},rating:'6段階をつなぐ展開仮説。的中確率ではありません'};
}
const api={VERSION,STAGES,MODES,build,validate,profiles:Legacy.profiles};if(typeof module!=='undefined')module.exports=api;root.RaceBrain=api;
})(typeof globalThis!=='undefined'?globalThis:this);
