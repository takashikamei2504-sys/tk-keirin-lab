/* Bounded counterplay comparison. Utilities are hypotheses, never measured probabilities. */
(function(root){'use strict';
const phaseName={home:'最終ホーム',back:'最終バック',late:'最終3〜4コーナー'};
function build(r,context,{ability,trait}){
 const by=new Map(r.riders.map(x=>[x.no,x])),lineOf=new Map();r.lineup.forEach(l=>l.forEach(n=>lineOf.set(n,l)));
 const who=n=>`${n}番${by.get(n).name}`;
 function review(s,phase,choices){
  const active=new Set(choices.filter(c=>c.actor&&c.feasibility!=='blocked').map(c=>c.actor)),leader=s.leader;
  const defender=s.defender||s.gap!=='breaks'&&lineOf.get(leader)[lineOf.get(leader).indexOf(leader)+1]||null;
  const rows=r.riders.slice().sort((a,b)=>a.no-b.no).map(x=>{
   const no=x.no,pos=s.order.indexOf(no),spent=s.energy[no]||0,line=lineOf.get(no),motive=context.lines.find(l=>l.leader===no);
   const reasons=[],waitReasons=[],counterplay=[],facts=[`${who(no)}は${pos+1}番手、脚質${x.style||'未取得'}、競走得点${x.score.toFixed(2)}`];
   const eligible=active.has(no),choice=choices.find(c=>c.actor===no),tags=choice?.reasoning?.intent_tags||[];
   if(!eligible){
    waitReasons.push(no===leader?'主導権を持っており、後続の仕掛けに合わせて踏む立場':no===defender?'番手の援護・縦踏み・差しを、この後の応答で比較する':line===lineOf.get(leader)&&s.connected[no]===false?'味方が先頭に立っており、味方を捲るより離れを詰めて再追走することを優先する':line[0]!==no&&s.connected[no]!==false?'自分のラインの前を追走する役割を優先する':'現在位置・消耗・進路の条件で、この地点からの仕掛けを候補にできない');
    return {no,position:pos+1,eligible:false,preferred:'wait',gain:null,attack_reasons:reasons,wait_reasons:waitReasons,counterplay,facts};
   }
   const continuing=(s.outside||[]).includes(no),supportMembers=line.slice(line.indexOf(no)+1).filter(n=>s.connected[n]!==false),support=supportMembers.length;
   const ownPower=ability(no),frontPower=ability(leader),edge=ownPower-frontPower;
   const fatigue=(s.energy[leader]||0)-spent,style=trait(no,'makuri',{...s,stage:phase==='home'?2:phase==='back'?3:4});
   let gain=edge*.65+(style-.5)*.35+fatigue*.85+(motive?.motivation||0)*.85+support*.045;
   gain+=(pos>=2&&pos<=3?.16:0)+(phase==='home'?-.12:phase==='back'?.10:.17)-Math.max(0,pos-2)*.065;
   if(tags.some(t=>['makuri','kamashi','lead'].includes(t))){gain+=.08;reasons.push('今回の本人の仕掛け意思を、ここで実行する判断に反映する');facts.push(...(choice.reasoning.facts||[]).filter(f=>f.kind==='race_intention').map(f=>f.label));}
   if(phase==='home')gain+=(trait(no,'long_makuri',{...s,stage:2})-.5)*.15;
   if(spent>=.4){gain-=.20;waitReasons.push('先の仕掛けで既に脚を使っており、すぐにもう一度加速する負担が大きい');}
   if(continuing){gain+=.20;reasons.push('既に外へ持ち出しており、ここで緩めるとそれまでの踏み出しを失う');}
   if(edge>=.06)reasons.push('先行側との得点・脚力の比較で、外から挑む価値がある');
   else if(edge<=-.12)waitReasons.push('先行側との脚力差があり、正面から踏み合うより消耗を避けたい');
   if(pos>=2&&pos<=3)reasons.push(`${pos+1}番手なら仕掛けの距離を抑えられる。待つ間に後方が動くと、この位置の優位を失う`);
   if(pos>=5)waitReasons.push('後方から外を長く回す負担が大きく、前の攻防を利用する必要がある');
   if(s.energy[leader]>=.22)reasons.push('前の攻防で先行側が脚を使った今が反撃の機会');
   else {gain-=.06;waitReasons.push('先行側に余力があり、早い仕掛けは踏み合いになる');}
   if(support)reasons.push(`${supportMembers.map(who).join('・')}を連れ、後続も勝負できる位置へ動く価値を重く見る`);
   if(motive?.facts.length){facts.push(...motive.facts);reasons.push(...motive.facts.filter(f=>!f.startsWith('今回の本人')).slice(0,2).map(f=>f+'という連係を重く見る'));}
   if(phase==='home')waitReasons.push('ここなら踏む距離を短くするためバックまで脚を残せる');
   else reasons.push('残る仕掛けどころが少なく、この先も待つと直線だけの勝負になる');
   if(!waitReasons.length)waitReasons.push(pos<=3?'この位置を使い、前団の後ろで直線の踏み出しまで脚を残す利点もある':'自分から外を回さず、前の仕掛けを追う方が踏む負担を抑えられる');
   if(defender&&defender!==no){
    const block=trait(defender,'block',{...s,stage:4});
    const resistance=.035+block*.08+Math.max(0,ability(defender)-ownPower)*.28;
    gain-=resistance;
    counterplay.push({no:defender,action:'block_or_vertical',reason:`${who(defender)}のブロックと縦踏みを想定。外を回す負担を仕掛けの評価から差し引く`});
   }
   counterplay.push({no:leader,action:'reaccelerate',reason:`${who(leader)}は主導権を譲らず踏み直す。仕掛ければ無抵抗で前に出られるとは置かない`});
   const third=r.lineup.map(l=>l[0]).filter(n=>n!==no&&n!==leader&&by.get(n).style!=='追'&&(s.energy[n]||0)<.55).sort((a,b)=>ability(b)-ability(a)||a-b)[0];
   if(third){gain-=Math.max(0,ability(third)-ownPower)*.18;counterplay.push({no:third,action:'counterattack',reason:`${who(third)}の追随・仕掛け返しも抵抗として差し引き、${phase==='late'?'直線に入る位置と消耗で比較する':'次の局面で再評価する'}`});}
   const gainRounded=Math.round(gain*1e6)/1e6;
   return {no,position:pos+1,eligible:true,preferred:gainRounded>0?'attack':'wait',gain:gainRounded,attack_reasons:reasons,wait_reasons:waitReasons,counterplay,facts,assessment:'脚力・位置・役割・消耗からの未校正の比較。選手の意思を確認した事実ではない'};
  });
  const best=rows.filter(x=>x.eligible&&x.gain>0).sort((a,b)=>b.gain-a.gain||a.no-b.no)[0],bestGain=best?.gain||0;
  const assessments=new Map(choices.map(c=>{
   const row=rows.find(x=>x.no===c.actor),gain=c.feasibility==='blocked'?-Infinity:row?.gain??0;
   const regret=bestGain-gain,ignored=best&&(!c.actor||regret>.035)?best:null;
   const waitExplanation=rows.filter(x=>x.eligible&&x.no!==c.actor).map(x=>({no:x.no,reason:c.actor&&gain>=Math.max(0,x.gain)?`${who(c.actor)}の仕掛けが先と評価し、${phase==='late'?'その動きへの追随と残るコースからの伸びを比較する':'追随・反撃を次の局面で問い直す'}`:x.wait_reasons.join('。'),challenge:x.preferred==='attack'}));
   return [c.key,{phase:phaseName[phase],phase_key:phase,choice:c.key,actor:c.actor||null,regret:Math.max(0,regret),passed:regret<=.035,
    objection:ignored?`${who(ignored.no)}は${ignored.position}番手からの仕掛けを待機より高く評価している。この反撃を置かずに前団を固定する展開は採用しない`:regret>.035?'仕掛けの負担が大きく、ここで動くより待つ判断を高く評価する':null,
    selected_reason:row?(row.attack_reasons.join('。')||'現在の位置と残る脚から仕掛ける'):(rows.filter(x=>x.eligible).map(x=>`${who(x.no)}：${x.wait_reasons.join('。')}`).join('／')||'別線は追走・進路の条件から新たに仕掛けず、前団の応答を評価する'),
    riders:rows,waiting:waitExplanation,reply:row?.counterplay||[]}];
  }));
  return {rows,assessments};
 }
 function response(s,choices){
  const n=s.defender,ownLine=n&&lineOf.get(n)===lineOf.get(s.leader),threat=s.cornerRider;
  const scores=new Map(choices.map(c=>{
   const tired=s.energy[s.leader]||0,spent=s.energy[n]||0;
   const score=c.key==='block'?(ownLine ? .40 : .12)+trait(n,'block',s)*.22-spent*.12+(threat ? .08 : 0):c.key==='vertical'?.16+trait(n,'finish',s)*.18+tired*.6: c.key==='follow'?.34+Math.max(0,.22-tired)*.4-(threat ? .13 : 0):0;
   return [c.key,score];
  }));
  const best=Math.max(...scores.values());return new Map(choices.map(c=>[c.key,{regret:best-scores.get(c.key),passed:best-scores.get(c.key)<=.035,phase:'番手の応答',actor:n||null,choice:c.key,
   selected_reason:c.key==='block'?'外の進出を止め、ラインの前を残す価値を縦踏みと比較した':c.key==='vertical'?'先行の消耗と自身の伸びを比べ、横の仕事より縦を優先した':'先行の余力を利用し、直線まで脚を残す価値を比較した',riders:[],waiting:[],reply:threat?[{no:threat,action:'press_through',reason:'外の仕掛けがブロックを越える場合も、次の成否分岐で検討する'}]:[]}]))}
 function audit(s){
  const reviews=s.decisions.filter(d=>d.deliberation).map(d=>d.deliberation),violations=reviews.filter(d=>!d.passed);
  const late=reviews.find(d=>d.phase_key==='late'),unanswered=(s.outside||[]).filter(no=>no!==s.cornerRider&&late?.riders.some(x=>x.no===no&&x.eligible&&x.preferred==='attack'));
  const issues=violations.map(d=>({phase:d.phase,objection:d.objection||'より自然な応答との差が残る'}));
  for(const no of unanswered)issues.push({phase:'最終3〜4コーナー',objection:`外に残る${who(no)}の再攻撃を処理していない`});
  return {passed:issues.length===0,checked:reviews.length,regret:reviews.reduce((a,d)=>a+d.regret,0),violations:issues,reviews};
 }
 return {review,response,audit};
}
const api={build};if(typeof module!=='undefined')module.exports=api;root.TacticalDeliberation=api;
})(typeof globalThis!=='undefined'?globalThis:this);
