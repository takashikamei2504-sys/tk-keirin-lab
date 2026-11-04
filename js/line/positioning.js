/* LAB LINE positioning cognition: goals -> ordered actions -> responses -> validated positions. */
(function(root){'use strict';
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
 const {r,lines,topology,f,ev,term,event,move,who,intentTerm,allocate,lineSupport,power}=env;
 const active=new Set(topology.active);
 const named=(id)=>who(id);
 function goal(id){
  const h=lines[id].head,lead=clamp(f(h,'initiative')*.70+power(id)*.12+Math.min(.12,(lines[id].length-1)*.05));
  const middle=clamp(f(h,'position')*.45+f(h,'makuri')*.32+f(h,'withdraw')*.16);
  const attack=clamp(f(h,'kamashi')*.40+f(h,'long_makuri')*.30+f(h,'sprint')*.20);
  const scores={lead,middle,attack,conserve:clamp(f(h,'withdraw')*.45+f(h,'makuri')*.20)};
  const primary=Object.entries(scores).sort((a,b)=>b[1]-a[1])[0][0];
  return {primary,scores,reason:named(id)+'の先行傾向・位置取り・捲り・仕掛けを比較した暫定的な目的',sources:[ev(h,'initiative'),ev(h,'position'),ev(h,'makuri'),ev(h,'withdraw'),ev(h,'kamashi')]};
 }
 function step(s,x){
  if(!s.positioning_steps)s.positioning_steps=[];
  const from=x.before.indexOf(x.actor);
  const name=x.action==='cut'?(from<=1?'middle_cut':'sequential_cuts'):x.action==='press'?(from<=1?'middle_press':'rear_press'):null;
  const pattern=PATTERNS.find(p=>p.id===name);
  s.positioning_steps.push({...x,sequence:s.positioning_steps.length+1,after:[...s.order],pattern_id:pattern?.id||null,pattern_label:pattern?.label||'好位奪取の個別反応',failure_condition:pattern?.failure||'相手との位置取り争いに敗れる',measured_time:false});
 }
 function reasonsForWait(s,acted){
  for(const id of s.order)if(!acted.has(id)){
   const g=goal(id),at=s.order.indexOf(id);
   event(s,id,'wait',named(id)+'は'+(at===0?'前方の主導権を維持':'他線の動きを観察して位置と余力を残す')+'。目標は'+g.primary+'で、今回の先動きは採用しない');
  }
 }
 function addThird(s,mover,front,intent){
  const out=[];
  // All remaining lines must have an opportunity to respond, not only to wait.
  for(const id of s.order.filter(x=>x!==mover&&x!==front&&active.has(x))){
   const g=goal(id),index=s.order.indexOf(id);
   if(intent==='cut'){
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
  term(hold,'rationality',fg.scores.lead,'前受けの主導権維持と他線の待機を比較。全ラインが先に動かない仮説',fg.sources);
  term(hold,'robustness',-Math.max(0,...threats.map(x=>x-fg.scores.lead)),'後方の積極型を無条件に待たせる候補を減点');
  reasonsForWait(hold,new Set());
  result.push(hold);
  for(const mover of s.order.slice(1).filter(id=>active.has(id))){
   const startIndex=s.order.indexOf(mover),mg=goal(mover);
   for(const intent of ['press','cut'])for(const response of ['resist','yield']){
    const t=clone(s);t.id=allocate();t.positioning_goals=Object.fromEntries(s.order.map(id=>[id,goal(id)]));
    const before=[...t.order],fh=lines[front].head,ah=lines[mover].head;
    t.burden[mover]=(t.burden[mover]||0)+1;
    intentTerm(t,mover,intent);intentTerm(t,front,response);
    event(t,mover,intent,named(mover)+'は'+(intent==='cut'?'一度前を斬って中団を取り直す':'主導権を取って後方を回避する')+'ため、位置'+(startIndex+1)+'から外を上昇');
    if(response==='resist'){
      t.burden[front]=(t.burden[front]||0)+2;
      t.burden[mover]++;
      // A blocked challenger may not mysteriously acquire the inner middle.
      event(t,front,'resist',named(front)+'は前を守って'+named(mover)+'の上昇を突っ張る');
      event(t,mover,'withdraw',named(mover)+'は突っ張られたため元の位置へ引き、次の仕掛けに備える。中団を自動取得しない');
      term(t,'feasibility',fg.scores.lead+power(front)-power(mover)-.45,'抵抗は前受けの先行意欲・脚力差で評価',[ev(fh,'initiative'),ev(fh,'ability'),ev(ah,'ability')]);
      term(t,'robustness',-.27,'突っ張りの踏み合いで双方が脚を使い、第三ラインに利益');
    }else{
      move(t,mover,0);
      event(t,front,'yield',named(front)+'は'+named(mover)+'を通す。ただし中団の確保は他線の反応次第');
      term(t,'feasibility',clamp(.30+mg.scores.lead*.45-startIndex*.06+f(ah,'sprint')*.12),'上昇の長さと先行意欲を考慮し、前受けの受入れを評価',[ev(ah,'initiative'),ev(ah,'sprint')]);
      term(t,'rationality',fg.scores.middle+f(fh,'withdraw')*.12-fg.scores.lead*.17,'前受けが出させる狙いと後続の好位争いを比較',fg.sources);
      if(intent==='cut'){
       t.pendingCut=mover;
       t.assumptions.push(named(mover)+'は先斬り後、他線を出させて中団を取り直す必要がある');
      }
    }
    step(t,{stage:'赤板付近',actor:mover,action:intent,response,target:front,before,goal:intent==='cut'?'middle':'lead',reason:response==='resist'?'前受けが突っ張り、上昇失敗':'前受けが出させる'});
    term(t,'rationality',intent==='cut'?mg.scores.middle:mg.scores.lead,'上昇側が本当に必要とする位置に対する戦術の合理性',mg.sources);
    term(t,'interaction',.35,'最初の上昇、前受けの反応、残りのラインの選択を順番に検討');
    term(t,'evidence',0,'位置取りの根拠は発走前特徴量と実戦記事。計算値は校正済みの確率ではない',mg.sources);
    const baseline=clone(t);reasonsForWait(baseline,new Set([mover,front]));result.push(baseline);
    if(response==='yield'){
      for(const third of addThird(t,mover,front,intent)){
        reasonsForWait(third,new Set([mover,front,third.positioning_steps.at(-1).actor]));
        result.push(third);
      }
    }
   }
  }
  return result;
 }
 return {early,goal};
}
const api={PATTERNS,initialOrders,create};
if(typeof module!=='undefined')module.exports=api;
root.LinePositioning=api;
})(typeof globalThis!=='undefined'?globalThis:this);
