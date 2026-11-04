/* LAB LINE positioning cognition: goals -> ordered actions -> responses -> validated positions. */
(function(root){'use strict';
const Physical=typeof module!=='undefined'?require('./physical.js'):root.LinePhysical;
const PATTERNS=Object.freeze([
 {id:'front_resist',label:'前受け突っ張り',goal:'lead',action:'resist',failure:'踏み負け・先行争いによる消耗'},
 {id:'front_yield',label:'前受け出させ',goal:'middle',action:'yield',failure:'狙った好位を別線に奪われる'},
 {id:'front_withdraw',label:'前受け引き切り',goal:'attack',action:'withdraw',failure:'後方から仕掛ける距離が不足'},
 {id:'middle_cut',label:'中団先斬り',goal:'middle',action:'cut',failure:'別線が出ず先頭に残される'},
 {id:'middle_hold',label:'中団維持',goal:'middle',action:'wait',failure:'後方に押さえ込まれる'},
 {id:'middle_press',label:'中団から押さえ',goal:'lead',action:'press',failure:'前受けが突っ張る'},
 {id:'rear_press',label:'後方押さえ先行',goal:'lead',action:'press',failure:'前受けの抵抗に遭う'},
 {id:'rear_kamashi',label:'後方カマシ',goal:'lead',action:'kamashi',failure:'前団の加速に届かない'},
 {id:'sequential_cuts',label:'斬って斬って',goal:'middle',action:'cut',failure:'後続が引き受けない'},
 {id:'lead_duel',label:'先行争い',goal:'lead',action:'resist',failure:'双方が脚を使って第三ラインに好機'},
 {id:'seat_contest',label:'飛び付き・イン粘り',goal:'seat',action:'seat',failure:'番手を奪えず競りが残る'},
 {id:'solo_use',label:'単騎の追走・割り込み',goal:'seat',action:'use',failure:'追走先や進路が塞がる'}
]);
const clone=x=>JSON.parse(JSON.stringify(x));
const clamp=x=>Math.max(0,Math.min(1,x));
function initialOrders(topology,front,max=4){
 const ids=topology.lines.map(l=>l.id),others=ids.filter(id=>id!==front),orders=[];
 const add=a=>{const key=a.join('|');if(!orders.some(x=>x.order.join('|')===key))orders.push({order:[front,...a],basis:'前受け以外の位置は未確定。複数の初手順を仮説として比較'});};
 add(others);
 if(others.length>1)add([...others].reverse());
 if(others.length>2)for(let i=1;i<others.length&&orders.length<max;i++)add([...others.slice(i),...others.slice(0,i)]);
 return orders.slice(0,max);
}
function create(env){
 const {r,lines,topology,f,ev,term,event,move,who,intentTerm,allocate,lineSupport,power,effortCharge}=env;
 const active=new Set(topology.active);
 const named=(id)=>who(id);
 // A solo's ability to self-attack does not imply an early lead versus a large line.
 const soloAgainstLongLine=id=>lines[id]?.length===1&&topology.lines.some(l=>l.id!==id&&l.length>=3&&active.has(l.id));
 function soloLeadSupported(id){
  if(lines[id]?.length!==1)return true;
  const name=String(r.riders.find(x=>x.no===lines[id].head)?.name||'').replace(/\s/g,'');
  return (r.race_material?.comments||[]).some(c=>{
   if(String(c.rider||'').replace(/\s/g,'')!==name||c.declaration_complete===false)return false;
   const words=String(c.declaration||c.excerpt||'');
   return /(?:単騎|一人).{0,16}(?:先行|逃げ|主導権|駆ける)|(?:先行|逃げ|主導権).{0,16}(?:単騎|一人)|(?:自分から|自分が).{0,8}(?:先行|主導権)/.test(words)&&
     !/先行しない|逃げない|主導権は取らない|かもしれない|できれば|ならば|しません/.test(words);
  });
 }

 function formation(id){
  const line=lines[id],head=line.head,followers=line.members.slice(1);
  const link=followers.length?followers.reduce((total,no)=>total+f(no,'track'),0)/followers.length:0;
  const leader={ability:power(id),initiative:f(head,'initiative'),endurance:f(head,'endurance'),makuri:f(head,'makuri')};
  return {size:line.length,head,followers:followers.length,link,leader,
   continuity:clamp(followers.length*.06+link*.11),
   trackingRisk:clamp(followers.length*.045+(1-link)*followers.length*.06),
   solo:line.length===1};
 }
 function matchup(front,mover){
  const a=formation(front),b=formation(mover),initiation=a.leader.initiative-b.leader.initiative,ability=a.leader.ability-b.leader.ability,depth=a.size-b.size;
  const pressure=initiation*.42+ability*.40+(a.continuity-b.continuity)*.45+Math.max(-.18,Math.min(.18,depth*.05));
  return {front:a,mover:b,pressure,advantage:pressure>0?'front':'mover',
   frontCanDefend:active.has(front)&&a.size>=3&&b.size<=2&&a.leader.initiative>=.54&&a.link>=.35&&pressure>.085,
   rationale:named(front)+'は'+a.size+'車（先行意欲'+a.leader.initiative.toFixed(2)+'、追走維持'+a.link.toFixed(2)+'）、'+named(mover)+'は'+b.size+'車（先行意欲'+b.leader.initiative.toFixed(2)+'）。ライン長は援護と選択肢を増やすが、先頭の加速力そのものを増やさない'};
 }
 function permitsStrategicYield(id){
  const rider=r.riders.find(x=>x.no===lines[id].head),name=String(rider?.name||'').replace(/\s/g,'');
  return (r.race_material?.comments||[]).some(c=>{
   if(String(c.rider||'').replace(/\s/g,'')!==name||c.declaration_complete===false)return false;
   const text=String(c.declaration||c.excerpt||'');
   return /引いて捲|引いてまく|出させて捲|出させてまく|出してから捲|出してからまく|一度引いて|前を取らせる/.test(text)
     &&!/しない|ません|ではない|かもしれない|できれば|なら/.test(text);
  });
 }
 function goal(id){
  const h=lines[id].head,rawLead=clamp(f(h,'initiative')*.70+power(id)*.12+Math.min(.12,(lines[id].length-1)*.05));
  const lead=soloAgainstLongLine(id)&&!soloLeadSupported(id)?Math.min(.28,rawLead*.40):rawLead;
  const middle=clamp(f(h,'position')*.45+f(h,'makuri')*.32+f(h,'withdraw')*.16);
  const attack=clamp(f(h,'kamashi')*.40+f(h,'long_makuri')*.30+f(h,'sprint')*.20);
  const scores={lead,middle,attack,conserve:clamp(f(h,'withdraw')*.45+f(h,'makuri')*.20)};
  const sources=[ev(h,'initiative'),ev(h,'position'),ev(h,'makuri'),ev(h,'withdraw'),ev(h,'kamashi')];
  if(!active.has(id))return {primary:'support',scores:{lead:0,middle:0,attack:0,conserve:scores.conserve},formation:formation(id),reason:named(id)+'は自力上昇を支持する脚質・当該レース情報がなく、先頭から斬る候補にはしない。ラインの並びが追込のみ等であれば通常の自力三分戦とは区別する',sources};
  const primary=Object.entries(scores).sort((a,b)=>b[1]-a[1])[0][0];
  const fm=formation(id),benefit=fm.size>=3?'後続の厚みによる援護と先行継続の選択肢':fm.size===2?'機動的な位置取り。ただし番手以外の援護はない':'単騎の自由な進路選択。ただしライン援護はない';
  return {primary,scores,formation:fm,reason:named(id)+'は'+fm.size+'車。'+benefit+'。先頭の加速力はライン長で増えない。追走維持の負担'+fm.trackingRisk.toFixed(2)+'と先行・位置取り・捲りを比較',sources};
 }
 function step(s,x){
  if(!s.positioning_steps)s.positioning_steps=[];
  const from=x.before.indexOf(x.actor);
  const name=x.action==='cut'?(from<=1?'middle_cut':'sequential_cuts'):x.action==='press'?(from<=1?'middle_press':'rear_press'):null;
  const pattern=PATTERNS.find(p=>p.id===name);
  const label=x.response==='second_yields'?'前受けラインの再上昇・主導権奪回':pattern?.label||'好位奪取の個別反応';
  s.positioning_steps.push({...x,sequence:s.positioning_steps.length+1,after:[...s.order],pattern_id:pattern?.id||null,pattern_label:label,failure_condition:pattern?.failure||'相手との位置取り争いに敗れる',measured_time:false});
   // All actual tactical events draw from one shared effort ledger.
 }
 function reasonsForWait(s,acted){
  for(const id of s.order)if(!acted.has(id)){
   const g=goal(id),at=s.order.indexOf(id);
   event(s,id,'wait',named(id)+'は'+(at===0?'前方の主導権を維持':'他線の動きを観察して位置と余力を残す')+'。目標は'+g.primary+'で、今回の先動きは採用しない');
  }
 }
 function standardThree(s){return s.order.length===3&&s.order.every(id=>active.has(id)&&lines[id].length>=2);}
 function middleFirstReason(s){
  if(!standardThree(s))return null;
  const [front,middle,rear]=s.order,mg=goal(middle),rg=goal(rear);
  const lead=lines[middle].head,rider=r.riders.find(x=>x.no===lead);
  const name=String(rider?.name||'').replace(/\s/g,'');
  const explicit=(r.race_material?.comments||[]).some(c=>
   String(c.rider||'').replace(/\s/g,'')===name&&c.declaration_complete!==false&&
   /先に動く|早めに動く|先行|主導権を取る|押さえて|積極的に/.test(String(c.declaration||''))&&
   !/しない|ません|なら|れば|かもしれ/.test(String(c.declaration||''))
  );
  if(explicit)return '今回の本人コメントに早めの主導権確保を示す根拠がある';
  if(mg.scores.lead-rg.scores.lead>.24&&mg.scores.lead>.64)return '中団の先行意欲が後方を明確に上回り、先に動く利益がある';
  return null;
 }
 function completeFrontRetake(s,initialFront,second,first){
  if(s.order.join('|')!==[second,first,initialFront].join('|')||!active.has(initialFront))return [];
  const a=goal(initialFront),head=r.riders.find(x=>x.no===lines[initialFront].head);
  // A three-rider line with a credible leader is a typical retake candidate.
  if(!(a.scores.lead>=.52||(lines[initialFront].length>=3&&a.scores.lead>=.42)||(head?.style==='逃'&&a.scores.lead>=.38)))return [];
  const t=clone(s),before=[...t.order];t.id=allocate();
  move(t,initialFront,0);t.burden[initialFront]=(t.burden[initialFront]||0)+1;t.pendingCut=null;
  event(t,initialFront,'press',named(initialFront)+'は'+named(first)+'→'+named(second)+'の先斬りに続き、再度前に出て主導権を取りに行く。ライン'+lines[initialFront].length+'車と先行意欲を考慮');
  event(t,second,'yield',named(second)+'は'+named(initialFront)+'を通して中団を狙う。ただし抵抗する別候補も残る');
  step(t,{stage:'打鐘直前',actor:initialFront,action:'press',response:'second_yields',target:second,before,goal:'lead',reason:'前受けラインが先行意欲とライン長に応じて主導権を取り返す'});
  term(t,'rationality',a.scores.lead+.08*Math.min(2,lines[initialFront].length-1),'先斬りに続く前受けラインの再上昇は、主導権獲得の利益とライン構成から検討',a.sources);
  term(t,'feasibility',a.scores.attack-.12,'最後の上昇には打鐘前の助走・前方ラインの受入れが必要（実測速度ではない）',a.sources);
  t.assumptions.push(named(second)+'が最終の上昇を受け入れ、'+named(initialFront)+'が打鐘までに先頭を取る必要がある');
  return [t];
 }
 function addThird(s,mover,front,intent){
  const out=[];
  // All remaining lines must have an opportunity to respond, not only to wait.
  for(const id of s.order.filter(x=>x!==mover&&x!==front&&active.has(x))){
   const g=goal(id),index=s.order.indexOf(id);
   if(intent==='cut'){
    const original=s.positioning_steps?.[0]?.before||[];
    const rearFirst=original.length===3&&original[2]===mover&&original[1]===id&&original[0]===front&&s.order.every(x=>active.has(x));
    if(rearFirst){
     if(soloAgainstLongLine(id)&&!soloLeadSupported(id)){
      // A solo can follow the leading line to recover middle, not recut to the front.
      const track=f(lines[id].head,'track'),position=f(lines[id].head,'position');
      if(track>=.30&&position>=.30){
       const t=clone(s),before=[...t.order];t.id=allocate();
       move(t,id,1);t.pendingCut=null;t.burden[id]=(t.burden[id]||0)+1;
       event(t,id,'position',named(id)+'は'+named(mover)+'の上昇に追走し、'+named(front)+'の後ろから中団へ。単騎でさらに前を斬ることは避ける');
       event(t,front,'yield',named(front)+'は追走して上昇する単騎を通し、後方で態勢を整える');
       step(t,{stage:'赤板後～打鐘前',actor:id,action:'position',response:'follow_long_line',target:front,before,goal:'middle',reason:'単騎は長いラインの加速を利用し、前を切らず中団確保を狙う'});
       term(t,'rationality',goal(id).scores.middle+track*.18,'先頭を引き受ける二度踏みより、別線利用による中団確保を比較',[ev(lines[id].head,'track'),ev(lines[id].head,'position')]);
       term(t,'feasibility',track*.35+position*.35-power(front)*.25-.14,'単騎が別線の動きに追走して中団へ進むには前方ラインの受入れが必要',[ev(lines[id].head,'track'),ev(lines[front].head,'ability')]);
       t.assumptions.push(named(mover)+'の上昇に追走でき、'+named(front)+'が中団を譲る場合のみ成立');
       out.push(t);
      }
      continue;
     }
     // C moves from the rear, B moves next to regain middle, A may finally retake lead.
     const t=clone(s),before=[...t.order];t.id=allocate();
     move(t,id,0);t.pendingCut=id;t.burden[id]=(t.burden[id]||0)+1;
     event(t,id,'cut',named(id)+'は後方'+named(mover)+'の上昇に反応し、後方へ追いやられないよう前を斬って中団を取り直す');
     event(t,mover,'yield',named(mover)+'は'+named(id)+'の上昇を受け入れる。なお、突っ張りとの比較が必要');
     step(t,{stage:'赤板後～打鐘前',actor:id,action:'cut',response:'rear_yields',target:mover,before,goal:'middle',reason:'後方の先斬りを受けた元中団の斬り返し'});
     term(t,'rationality',g.scores.middle+.23,'後方が先に動いたことを受け、中団を取り直す合理性',g.sources);
     term(t,'feasibility',clamp(.35+f(lines[id].head,'position')*.3+f(lines[id].head,'sprint')*.2-index*.05),'後方上昇の勢いと斬り返しの負担を比較',g.sources);
     t.assumptions.push(named(mover)+'が'+named(id)+'に前を譲り、'+named(id)+'が先に動いたラインを交わす必要がある');
     out.push(t,...completeFrontRetake(t,front,id,mover));
     // Rear C can also resist B. The standard path is not mandatory.
     const resisted=clone(s);resisted.id=allocate();resisted.burden[id]=(resisted.burden[id]||0)+2;resisted.burden[mover]=(resisted.burden[mover]||0)+1;resisted.pendingCut=null;
     event(resisted,id,'cut',named(id)+'は中団を取り直そうと上昇する');
     event(resisted,mover,'resist',named(mover)+'は元中団の斬り返しを突っ張り、前を譲らない');
     event(resisted,id,'withdraw',named(id)+'は突っ張られて後方に留まり、無条件に好位を得ない');
     step(resisted,{stage:'赤板後～打鐘前',actor:id,action:'cut',response:'rear_resists',target:mover,before:[...s.order],goal:'middle',reason:'Cの突っ張りによりBの斬り返しは不成立'});
     term(resisted,'feasibility',g.scores.middle-goal(mover).scores.lead-.26,'Bの斬り返しとCの抵抗が競合する分岐',[...g.sources,...goal(mover).sources]);
     resisted.assumptions.push(named(mover)+'が突っ張るなら'+named(id)+'の中団奪回は不成立');
     out.push(resisted);
     continue;
    }
    // A solo must not become the next leader automatically after another line cuts.
    if(soloAgainstLongLine(id)&&!soloLeadSupported(id))continue;
    const t=clone(s),before=[...t.order];t.id=allocate();
    move(t,id,0);t.pendingCut=null;t.burden[id]=(t.burden[id]||0)+1;
    event(t,id,'press',named(id)+'は'+named(mover)+'の先斬りを受け、赤板から打鐘へ主導権を引き受ける');
    event(t,mover,'yield',named(mover)+'は先斬りの目的どおり、後続を通して中団を狙う');
    step(t,{stage:'打鐘前',actor:id,action:'press',response:'cut_yields',target:mover,before,goal:g.primary,reason:'先斬りの後の主導権引受け'});
    term(t,'rationality',g.scores.lead-.15*(index>1),'斬りを受けるラインの主導権意欲と上昇距離を比較',g.sources);
    term(t,'feasibility',clamp(.30+f(lines[id].head,'kamashi')*.4+power(id)*.20-index*.08),'続く押さえが物理的に間に合うことは未確定',g.sources);
    t.assumptions.push(named(id)+'が'+named(mover)+'を追い越す十分な上昇機会が必要');
    out.push(t);
   }else if(index>=2){
    const incumbent=s.order[1],occupant=goal(incumbent);
    const ability=power(id)*.38+f(lines[id].head,'position')*.42+f(lines[id].head,'sprint')*.2;
    const resistance=power(incumbent)*.25+occupant.scores.middle*.40;
    // Moving from rear to middle requires an actual pass; it is never automatic.
    if(ability+.12<resistance)continue;
    const t=clone(s),before=[...t.order];t.id=allocate();
    move(t,id,1);t.burden[id]=(t.burden[id]||0)+1;
    event(t,id,'position',named(id)+'は先行ライン'+named(mover)+'の後ろを狙い、'+named(incumbent)+'を外から交わして中団を確保する');
    event(t,incumbent,'yield',named(incumbent)+'は中団争いで後方へ下がる');
    step(t,{stage:'打鐘前',actor:id,action:'position',response:'middle_pass',target:incumbent,before,goal:'middle',reason:'先行を追う中団の奪い合い'});
    term(t,'feasibility',ability-resistance,'元の中団を実際に交わす必要がある。無条件の割り込みは禁止',[ev(lines[id].head,'position'),ev(lines[id].head,'sprint'),ev(lines[incumbent].head,'position')]);
    term(t,'rationality',g.scores.middle-.12,'中団確保と外から追走する負担を比較',g.sources);
    t.assumptions.push(named(id)+'が'+named(incumbent)+'を交わして中団へ入れることが必要');
    out.push(t);
   }
  }
  return out;
 }
 function early(s){
  const result=[],front=s.order[0],fg=goal(front);
  const hold=clone(s);hold.positioning_goals=Object.fromEntries(s.order.map(id=>[id,goal(id)]));
  const threats=s.order.slice(1).filter(id=>active.has(id)).map(id=>goal(id).scores.lead);
  if(standardThree(s))term(hold,'rationality',-.65,'自力三分戦で後方が赤板まで動かない仮説は、後方不利を受け入れる特殊な根拠が必要');
  term(hold,'rationality',fg.scores.lead,'前受けの主導権維持と他線の待機を比較。全ラインが先に動かない仮説',fg.sources);
  term(hold,'robustness',-Math.max(0,...threats.map(x=>x-fg.scores.lead)),'後方の積極型を無条件に待たせる候補を減点');
  reasonsForWait(hold,new Set());
  result.push(hold);
  for(const mover of s.order.slice(1).filter(id=>active.has(id))){
   if(soloAgainstLongLine(mover)&&!soloLeadSupported(mover))continue;
   const startIndex=s.order.indexOf(mover),mg=goal(mover);
   for(const intent of ['press','cut'])for(const response of ['resist','yield']){
    const duel=matchup(front,mover);
    // A short line can briefly cut in front, but cannot claim an easy sustained
    // surrender by a strong 3/4-rider line without a causal strategy.
    if(response==='yield'&&intent==='press'&&duel.frontCanDefend&&!permitsStrategicYield(front))continue;
    const t=clone(s);t.id=allocate();t.positioning_goals=Object.fromEntries(s.order.map(id=>[id,goal(id)]));
    const before=[...t.order],fh=lines[front].head,ah=lines[mover].head;
    t.burden[mover]=(t.burden[mover]||0)+1;
    if(standardThree(s)){
     const rear=s.order[2],exception=middleFirstReason(s);
     if(mover===rear){
      term(t,'rationality',.72,'自力三分戦の後方ラインは、後方不利を解消するため赤板で先に上昇する基本形',mg.sources);
     }else{
      term(t,'rationality',exception?.20:-.82,exception?'中団が先に動く例外的な判断：'+exception:'後方の自力ラインが動かず、中団だけが先に斬るには特別な根拠が不足',[...mg.sources,...goal(rear).sources]);
      t.assumptions.push(exception||'中団の先動きを選ぶには、後方ラインが動かない事情が必要');
     }
    }
    term(t,'interaction',(response==='resist'?duel.pressure:-duel.pressure)*.52,'ライン長だけでなく先頭の先行意欲・脚力と後続の追走能力を比較：'+duel.rationale,[ev(lines[front].head,'initiative'),ev(lines[mover].head,'initiative'),ev(lines[front].head,'ability'),ev(lines[mover].head,'ability')]);
    if(response==='yield'&&duel.frontCanDefend){
     term(t,'robustness',-.36,'主導権に合理性のある長いラインが短いラインを通すのは一時的な位置交換か明確な引いて捲り戦術。無抵抗で主導権を失うものとは扱わない',fg.sources);
     t.assumptions.push(named(front)+'が'+named(mover)+'を一時的に通した後の反撃・脚の温存・事前意思が必要。'+duel.rationale);
    }
    intentTerm(t,mover,intent);intentTerm(t,front,response);
    event(t,mover,intent,named(mover)+'は'+(intent==='cut'?(startIndex>=2?'後方不利を解消し、次の位置取りの選択肢を得るため一度前を斬る':'一度前を斬って中団を取り直す'):'主導権を取って後方を回避する')+'ため、位置'+(startIndex+1)+'から外を上昇');
    if(response==='resist'){
      if(duel.frontCanDefend)term(t,'rationality',.32,'長い先行ラインが短い上昇ラインに抵抗する戦術的合理性。ただし突っ張りの消耗と成功・失敗を比較',[ev(lines[front].head,'initiative'),ev(lines[front].head,'endurance')]);
      t.burden[front]=(t.burden[front]||0)+2;
      t.burden[mover]++;
      // A blocked challenger may not mysteriously acquire the inner middle.
      event(t,front,'resist',named(front)+'は前を守って'+named(mover)+'の上昇を突っ張る');
      event(t,mover,'withdraw',named(mover)+'は突っ張られたため元の位置へ引き、次の仕掛けに備える。中団を自動取得しない');
      term(t,'feasibility',fg.scores.lead+power(front)-power(mover)-.45,'抵抗は前受けの先行意欲・脚力差で評価',[ev(fh,'initiative'),ev(fh,'ability'),ev(ah,'ability')]);
      term(t,'robustness',-.27,'突っ張りの踏み合いで双方が脚を使い、第三ラインに利益');
    }else{
      move(t,mover,0);
      event(t,front,'yield',named(front)+'は'+named(mover)+'を一度通す。ただし主導権を恒久的に譲ったのではなく、前への巻き返しと中団維持を別々に比較する');
      term(t,'feasibility',clamp(.30+mg.scores.lead*.45-startIndex*.06+f(ah,'sprint')*.12),'上昇の長さと先行意欲を考慮し、前受けの受入れを評価',[ev(ah,'initiative'),ev(ah,'sprint')]);
      term(t,'rationality',fg.scores.middle+f(fh,'withdraw')*.12-fg.scores.lead*.17,'前受けが出させる狙いと後続の好位争いを比較',fg.sources);
      if(intent==='cut'){
       t.pendingCut=mover;
       t.assumptions.push(named(mover)+'は先斬り後、他線を出させて中団を取り直す必要がある');
      }
    }
    step(t,{stage:'赤板付近',actor:mover,action:intent,response,target:front,before,goal:intent==='cut'?(startIndex>=2?'rear_escape':'middle'):'lead',reason:response==='resist'?'前受けが突っ張り、上昇失敗':'前受けが出させる'});
    term(t,'rationality',intent==='cut'?(startIndex>=2?mg.scores.lead*.55+mg.scores.middle*.45:mg.scores.middle):mg.scores.lead,'上昇側が本当に必要とする位置に対する戦術の合理性',mg.sources);
    term(t,'interaction',.35,'最初の上昇、前受けの反応、残りのラインの選択を順番に検討');
    term(t,'evidence',0,'位置取りの根拠は発走前特徴量と実戦記事。計算値は校正済みの確率ではない',mg.sources);
    const baseline=clone(t);reasonsForWait(baseline,new Set([mover,front]));result.push(baseline);
    if(response==='yield'){
      for(const third of addThird(t,mover,front,intent)){
        reasonsForWait(third,new Set([front,...third.positioning_steps.map(x=>x.actor)]));
        result.push(third);
      }
    }
   }
  }
  return result;
 }
 function slipstreamCounter(s){
  // Only after a genuine final-home attack from the REAR, and only when the middle line can react.
  const attack=s.outside;
  if(!attack||s.secondary||attack.from<2||s.order.length!==3||!active.has(attack.id))return [];
  const rear=s.order[2],middle=s.order[1],front=s.order[0];
  if(attack.id!==rear||!active.has(middle)||s.used.includes(middle))return [];
  const rearNo=lines[rear].head,middleNo=lines[middle].head;
  const tracking=f(middleNo,'track'),kamashi=f(middleNo,'kamashi'),rearBurst=f(rearNo,'sprint');
  if(tracking<.30||kamashi<.36||rearBurst<.35)return [];
  const opportunity=Physical.middlePassOpportunity(s,rear,middle,(id,key)=>f(lines[id].head,key));
  if(!opportunity.allowed)return [];
  const t=clone(s);t.id=allocate();t.cut_resolution='draft_counter';t.used.push(middle);
  // First A reaches and passes C on the outside. It does not acquire the lead by a teleport.
  t.outside={...t.outside,from:1,anchor:front,progress:'後方Aが外から中団Cを交わし、前団外へ接近'};
  event(t,rear,'pass_middle',named(rear)+'は最終ホームからの加速で'+named(middle)+'の外へ上昇し、中団を交わした。先頭ラインはまだ越えていない');
  // The overtaking event is charged once in the shared ledger.
  // C follows A's wheel at reduced effort, then uses the gained speed to launch once.
  event(t,middle,'draft',named(middle)+'は中団からむやみに前へ斬らず、'+named(rear)+'の加速を見てその後ろに入り、外の風圧負担を抑えて追走する');
  // The draft event is charged once in the shared ledger.
  // The counterattack costs effort when its event is recorded.
  t.secondary={id:middle,anchor:front,target_line:front,kind:'kamashi',from:1,started:s.scenes.length,progress:'後方Aの上昇を利用し、追走後に外からカマシ',followers:[]};
  t.attacks.push({id:middle,kind:'kamashi',from:1,phase:s.scenes.length,trigger:rear,transition:'draft_then_counter'});
  t.burden[middle]=(t.burden[middle]||0)+1;
  event(t,middle,'kamashi',named(middle)+'は'+named(rear)+'の動きで得た速度を利用してカマシ気味に加速。先行意欲と追走適性を満たし、独力の二度踏みより脚を抑えることを狙う');
  const burst=t.effort?.[middle]?.actions?.at(-1)||{repeat:0};
  const preference=goal(middle),effort=t.effort?.[middle]?.spent||0;
  term(t,'rationality',preference.scores.lead*.50+kamashi*.35+tracking*.15-preference.scores.middle*.35-effort*.12,'好位を捨てるのは、自力の二度踏みではなく後方Aの加速を利用できる時に限る',[ev(middleNo,'initiative'),ev(middleNo,'kamashi'),ev(middleNo,'track')]);
  term(t,'feasibility',kamashi*.4+tracking*.3+rearBurst*.2-power(front)*.18-effort*.16,'AがCを追い越す→Cがその後ろを追走→Cが再加速して前団外へ、の順序を必要とする',[ev(middleNo,'kamashi'),ev(middleNo,'track'),ev(rearNo,'sprint')]);
  term(t,'interaction',.5,'後方ラインの実際の加速を契機とする中団ラインの追走とカウンター');
  term(t,'robustness',burst.repeat?-.08*burst.repeat:.06,'再加速の消耗・追走距離の不足を反証として残す');
  t.assumptions.push('成立条件：'+opportunity.reason+'（相対加速指標'+opportunity.potential+'、実測速度ではない）');
  t.assumptions.push(named(rear)+'が最終ホームで動き、'+named(middle)+'の外を実際に交わしてから中団ラインが追走を開始できる必要');
  t.assumptions.push(named(middle)+'には追走後に加速するための間隔と残存脚が必要。Aが動かなければ本仮説は成立しない');
  return [t];
 }
 return {early,goal,slipstreamCounter,soloLeadSupported,soloAgainstLongLine,formation,matchup,permitsStrategicYield};
}
const api={PATTERNS,initialOrders,create};
if(typeof module!=='undefined')module.exports=api;
root.LinePositioning=api;
})(typeof globalThis!=='undefined'?globalThis:this);
