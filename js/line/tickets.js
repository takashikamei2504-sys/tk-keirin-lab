/* Line-first tickets: one main race scenario, conditional close-finish variations.
 * Target about twelve or fewer picks. No padding, no fabricated passing route,
 * and no claim that heuristic margins are measured probabilities.
 */
(function(root){'use strict';
const MAX_TICKETS=12;
const round=x=>Math.round(x*1000)/1000;
const key=t=>t.join('-');
const difference=(a,b)=>a-b;
const validTrio=trio=>trio.length===3&&new Set(trio).size===3&&trio.every(Number.isInteger);
const value=(input,no,feature)=>input?.features?.[no]?.[feature]?.value;
const basis=(input,no,feature)=>input?.features?.[no]?.[feature]?.basis||'資料未取得';
const feature=(input,no,name,def=.45)=>Number.isFinite(value(input,no,name))?value(input,no,name):def;
function variations(main,input){
 if(!input?.features||!input?.race||!main?.scenes?.[4])return [];
 const corner=main.scenes[4],control=corner.control,lead=corner.groups.find(g=>g.id===control&&g.lane===0);
 if(!lead||!lead.members.length)return [];
 const [leader,second,attachedThird]=lead.members,sourceLine=input.race.lineup?.find(l=>l[0]===leader),third=Number.isInteger(sourceLine?.[2])&&main.innerRoute?.no===sourceLine[2]?sourceLine[2]:attachedThird,posit=corner.positions||{},active=[main.outside,main.secondary].filter(Boolean);
 const connected=no=>Number.isInteger(no)&&!main.detached?.includes(no)&&posit[no]&&posit[no].band!=='detached'&&posit[no].band!=='contest';
 const finish=no=>feature(input,no,'finish'),power=no=>feature(input,no,'ability'),speed=no=>feature(input,no,'makuri');
 const burden=no=>(main.riderBurden?.[no]||0)*.045;
 const baseScore=no=>finish(no)*.44+power(no)*.36+speed(no)*.20-burden(no);
 const grounds=no=>no+'番の競走得点由来の力量（'+basis(input,no,'ability')+'）、直線傾向（'+basis(input,no,'finish')+'）、仕掛け傾向（'+basis(input,no,'makuri')+'）';
 const suggestions=[];
 function add(pair,mode,reason,signals=[],priority=.5){
  if(!pair.every(connected)||pair[0]===pair[1])return;
  const thirdCandidates=new Set([leader,second,third,...(main.finish?.thirds||[]).map(t=>t.no),...(input.race.riders||[]).map(x=>x.no)]);
  for(const a of active){
   if(a.id===control)continue;
   const g=corner.groups.find(x=>x.id===a.id&&x.attack);
   if(g?.members?.[0])thirdCandidates.add(g.members[0]);
  }
  const ranked=[...thirdCandidates].filter(no=>connected(no)&&!pair.includes(no)).map(no=>{
   const loc=posit[no],near=(loc.ordinal??99)<=4&&['inner','inside','outside'].includes(loc.band);
   if(!near)return null;
   const relevance=baseScore(no)-(loc.ordinal??5)*.04+(loc.band==='inside'?.07:0);
   return {no,relative:relevance,reason:no+'番は4角の'+(loc.band==='outside'?'外並走':loc.band==='inside'?'内進路':(loc.ordinal+1)+'番手')+'から3着を争う。'+grounds(no)};
  }).filter(Boolean).sort((a,b)=>b.relative-a.relative||a.no-b.no);
  const bestRelative=ranked[0]?.relative??-Infinity;
  for(const t of ranked.filter(x=>x.relative>=bestRelative-.24).slice(0,4)){
   const trio=[...pair,t.no];
   if(!validTrio(trio))continue;
   suggestions.push({trio,key:key(trio),group:'variation',hypothesis:main.id,supporting_hypotheses:[main.id],variation:{pair,mode,signals,corner_phase:corner.phase,source_hypothesis:main.id,kind:'same-corner'},score:round(priority+Math.min(.12,t.relative*.08)),reason:mode+'。'+reason+'。'+t.reason});
  }
 }
 // Third place may change by a tyre width even when the primary 1-2 pair holds.
 // Expand only to riders already within range at the final corner, and compare
 // the actual feature-based finish evidence instead of filling 12 slots.
 if(main.finish?.pair?.length===2){
  const [first,runner]=main.finish.pair;
  if(connected(first)&&connected(runner)){
   add([first,runner],'同じ1・2着の3着僅差争い','本線の主導権・仕掛けを変えず、4角で射程にいる選手の脚色・力量・位置差から3着争いを再評価。実測着差や確率ではない',['third-place-close-finish'],.69);
  }
 }
 // No forced swap: both original line members must remain connected and
 // the gap between lead endurance and marker's finish strength must be close.
 if(connected(leader)&&connected(second)){
  const gap=Math.abs((main.finish?.leaderStrength??baseScore(leader))-(main.finish?.followStrength??baseScore(second)));
  if(gap<=.28){
   const pair=main.finish.pair[0]===second?[leader,second]:[second,leader];
   add(pair,'先行と番手の僅差入れ替わり','同じ先行・追走関係のまま、踏み直しと差し脚の比較が拮抗（暫定比較差'+round(gap)+'）。'+grounds(leader)+'。'+grounds(second),['paired-line','close-finish'],.72-gap*.6);
  }
 }
 // An external attacker must already be represented in the same corner scene.
 // No last-moment fictional makuri merely to broaden a ticket portfolio.
 for(const a of active){
  const g=corner.groups.find(x=>x.id===a.id&&x.attack),attacker=g?.members?.[0];
  if(!attacker||a.id===control||!connected(attacker)||posit[attacker].band!=='outside'||a.from>1&&['short','counter','relaunch'].includes(a.kind))continue;
  const progress=String(a.progress||''),anchor=String(a.anchor||'');
  const inRange=posit[attacker].ordinal<=3||anchor===control;
  if(!inRange||/不発|失速|止ま/.test(progress))continue;
  const mover=baseScore(attacker)-Math.max(0,(posit[attacker].ordinal??3)-2)*.065;
  const leadScore=baseScore(leader)-(main.burden?.[control]||0)*.025;
  const secondScore=second?baseScore(second):null;
  const viability=Math.max(mover-leadScore,secondScore===null?-1:mover-secondScore);
  if(viability<-.23)continue;
  const explanation=attacker+'番の'+a.kind+'が最終4角まで外並走で継続しており、前団と接近。'+grounds(attacker)+'。先行・番手の双方が仕掛けへの対応で余力を使う可能性';
  if(connected(second)){
   if(mover>=leadScore-.19)add([second,attacker],'番手が先頭を交わし、別線の捲りが2着へ',explanation+'。先行車は3着に粘る余地', ['outside-attack','marker-holds'],.73+viability*.14);
   if(mover>=secondScore-.13)add([attacker,second],'別線の捲りが差し切り、番手が2着へ',explanation,['outside-attack','winner-changes'],.65+viability*.13);
  }
  if(mover>=leadScore-.16)add([leader,attacker],'先行が踏み直し、外の捲りが2着へ',explanation,['outside-attack','leader-holds'],.58+viability*.14);
 }
 // Third-place line member can move up only when a defensible lane emerges.
 // A strong finishing trait alone is not a fabricated two-rider jump.
 const defended=(main.defenses||[]).some(d=>d.action==='block')||main.defense?.action==='block';
 const thirdInside=main.innerRoute?.no===third||posit[third]?.band==='inside';
 if(connected(third)&&connected(second)&&connected(leader)&&
    (defended||thirdInside)&&finish(third)>=.52){
  const outsideSecond=main.defense?.action==='block'||(main.defenses||[]).some(d=>d.action==='block');
  const rel=baseScore(third)-Math.max(baseScore(leader),baseScore(second));
  if(rel>=-.25){
   const explanation='3番手'+third+'番が連結を維持し、'+(outsideSecond?'番手の牽制に伴う内の進路変化':'4角で確認した内進路')+'を使う。'+grounds(third)+'。内の進路は確定した事実でなく、牽制と脚色に条件付けた仮説';
   add([second,third],'番手差しに3番手が続く',explanation,['third-line','inside-route'],.59+rel*.2);
   if(rel>=-.12&&feature(input,third,'inside')>=.48){
    add([third,second],'3番手の中割り・縦脚が勝つ',explanation,['third-line','inside-route','winner-changes'],.46+rel*.2);
   }
  }
 }
 return suggestions.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
}
function generate(main,alternatives,input){
 const seen=new Map(),reviews=[],mainPool=[],variationPool=[],altPool=[];
 function addCandidate(t,pool){
  if(!validTrio(t.trio)||!t.reason)return;
  if(seen.has(t.key)){const old=seen.get(t.key);for(const id of t.supporting_hypotheses)if(!old.supporting_hypotheses.includes(id))old.supporting_hypotheses.push(id);return;}
  seen.set(t.key,t);pool.push(t);
 }
 function emit(h,primary,pool){
  const gap=main.score-h.score;
  if(!h.audit?.passed||(!primary&&!Number.isFinite(gap))){
   reviews.push({hypothesis:h.id,accepted:false,gap,added:0,reason:!h.audit?.passed?'局面の整合性検査を通過していない':'候補の比較差が不正'});return;
  }
  const events=h.scenes.flatMap(s=>s.events).filter(e=>['pass','resist','yield','long','kamashi','short','counter','relaunch','inside','seat_won'].includes(e.action));let count=0;
  for(const [i,third] of h.finish.thirds.entries()){
   const trio=[...h.finish.pair,third.no],k=key(trio);
   if(!validTrio(trio)||!third.reason)continue;
   if(seen.has(k)){const old=seen.get(k);if(!old.supporting_hypotheses.includes(h.id))old.supporting_hypotheses.push(h.id);continue;}
   addCandidate({trio,key:k,hypothesis:h.id,supporting_hypotheses:[h.id],group:primary?'main':'alternative',score:primary?1-i*.035:Math.max(.07,.66-Math.max(0,gap)*.21-i*.025+(h.finish.pair[0]!==main.finish.pair[0]?.045:0)),reason:primary?third.reason:h.finish.mode+'の別展開：'+events.map(e=>e.reason).join('。')+'。'+third.reason},pool);
   count++;
  }
  reviews.push({hypothesis:h.id,accepted:count>0,gap,added:count,reason:primary?'本線展開から導く主要決着':'異なる6局面を通った別展開の着順候補'});
 }
 emit(main,true,mainPool);
 for(const t of variations(main,input||{}))addCandidate(t,variationPool);
 for(const alt of alternatives)emit(alt,false,altPool);
 // Compare supported finish pairs on marginal value, not fixed slots by group.
 // A repeated first/second pair has lower incremental coverage. No class is forced
 // into the ticket set; an unsupported upset cannot be manufactured to add variety.
 const chosen=[],chosenKeys=new Set(),all=[...mainPool,...variationPool,...altPool];
 const perPair=new Map(),perWinner=new Map();
 while(chosen.length<MAX_TICKETS){
  let best=null,bestUtility=-Infinity;
  for(const t of all){
   if(chosenKeys.has(t.key))continue;
   const pair=t.trio.slice(0,2).join('-'),count=perPair.get(pair)||0;
   const winnerCount=perWinner.get(t.trio[0])||0;
   // Scores are uncalibrated hypothesis support, not probabilities or EV.
   const utility=t.score-.105*count-.035*winnerCount;
   if(utility>bestUtility+1e-10||Math.abs(utility-bestUtility)<=1e-10&&t.key.localeCompare(best?.key||'')<0){best=t;bestUtility=utility;}
  }
  if(!best||bestUtility<.05)break;
  chosen.push(best);chosenKeys.add(best.key);
  const pair=best.trio.slice(0,2).join('-');
  perPair.set(pair,(perPair.get(pair)||0)+1);
  perWinner.set(best.trio[0],(perWinner.get(best.trio[0])||0)+1);
 }
 for(const r of reviews){const included=chosen.filter(t=>t.supporting_hypotheses.includes(r.hypothesis));r.added=included.length;r.accepted=included.length>0&&r.accepted;if(r.accepted&&included.length<mainPool.filter(x=>x.hypothesis===r.hypothesis).length)r.reason+='。買い目全体の上限と重複を考慮して一部採用';}
 return {tickets:chosen,policy:{method:'causal-marginal-pair-coverage-v2',comparison_margin:null,target_count:null,max_count:MAX_TICKETS,fixed_count:false,reviews,groups:{main:chosen.filter(x=>x.group==='main').length,variation:chosen.filter(x=>x.group==='variation').length,alternative:chosen.filter(x=>x.group==='alternative').length},note:'本線の6局面を維持し、4角での位置・外並走・内進路・選手の力量と直線特性で僅差決着の揺らぎを検討。買い目は本線・4角の着順変化・別展開を固定枠なしで比較。点数は最大12点、根拠がなければ埋めない。特徴量と閾値は未校正、確率・回収率を意味しない。'}};
}
const api={generate,variations};if(typeof module!=='undefined')module.exports=api;root.LineTickets=api;
})(typeof globalThis!=='undefined'?globalThis:this);
