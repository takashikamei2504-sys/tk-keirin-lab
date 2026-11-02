/* Line-level causal reactions with conservative one-line overtakes.
 * Keep actions, placements, and descriptions derived from the SAME selected
 * state. No text-only attacks, imaginary lanes or invented rider intentions.
 */
(function(root){'use strict';
function build(r){
 const lines=r.lineup.map(l=>[...l]),by=new Map(r.riders.map(x=>[x.no,x]));
 const lineOf=new Map(lines.flatMap(l=>l.map(n=>[n,l])));
 const who=no=>no+'番'+(by.get(no)?.name||'');
 function position(order,no){return order.indexOf(no)+1;}
 function contiguous(s,head){
  const line=lineOf.get(head);
  if(!line||line[0]!==head)return [];
  const i=s.order.indexOf(head),result=[head];
  for(const no of line.slice(1)){
   if(s.connected[no]===false||s.order[i+result.length]!==no)break;
   result.push(no);
  }
  return result;
 }
 // A second line may exploit an existing confrontation by passing exactly
 // one adjacent rival line, but never the current leader as a free reaction.
 function possibleCounter(s,head){
  if(!s.attacker||by.get(head)?.style==='追'||head===s.attacker||head===s.leader||head===s.front)return null;
  const own=contiguous(s,head),at=s.order.indexOf(head);
  if(!own.length||at<2||s.connected[head]===false)return null;
  const before=s.order[at-1],previous=lineOf.get(before),previousHead=previous?.[0];
  if(!previous||previousHead===head||previous.includes(s.leader))return null;
  let start=at-1;
  while(start>0&&previous.includes(s.order[start-1]))start--;
  if(start<2)return null; // no free pass over the controlling front group
  return {no:head,members:own,from:at+1,to:start+1,preceding:previousHead,previousMembers:s.order.slice(start,at)};
 }
 function counters(s){
  return lines.map(l=>l[0]).map(n=>possibleCounter(s,n)).filter(Boolean);
 }
 function applyCounter(s,no,move){
  const candidate=possibleCounter(s,no);
  if(!candidate)throw Error('第三ラインの進出が現位置から成立しません');
  s.redThird=no;s.redThirdFrom=candidate.from;s.redThirdAhead=candidate.preceding;
  move(s,candidate.members,candidate.to-1,'赤板の攻防を利用し、直前の別線一組を追い越して位置を上げる');
  if(position(s.order,no)>=candidate.from)throw Error('第三ラインが位置を上げていません');
  s.energy[no]=Math.min(.95,(s.energy[no]||0)+.12);
  for(const follower of candidate.members.slice(1))s.energy[follower]=Math.min(.95,(s.energy[follower]||0)+.04);
  return {...candidate,final:position(s.order,no)};
 }
 // Bounded secondary reaction: one adjacent rival line may be passed, never
 // the controlling front group. Every other line keeps an explicit wait reason.
 function laterOptions(s,phase){
  const primary=phase==='home'?s.homeRider:phase==='back'?s.backRider:s.cornerRider;
  const rows=lines.map(line=>{
   const no=line[0],at=s.order.indexOf(no),spent=s.energy[no]||0;
   const candidate=primary&&no!==primary&&no!==s.leader&&!s.outside.includes(no)&&by.get(no).style!=='追'&&spent<.65?possibleCounter({...s,attacker:primary,front:s.leader},no):null;
   const gain=candidate?.12+Math.max(0,(s.energy[s.leader]||0)-spent)*.25-Math.max(0,at-3)*.04:0;
   return {no,candidate,gain,reason:no===primary?'自分の仕掛けを継続する':no===s.leader?'前団の踏み直しと後続への応答を優先する':spent>=.65?'先の攻防で脚を使っており、再加速を控える':candidate?'直前の別線を一組だけ越える選択と、脚を残す待機を比較する':'前団を一気に越える位置ではなく、前の仕掛けを利用して脚を残す'};
  });
  return {primary,rows,choices:[{key:'wait',weight:.85,feasibility:'allowed'},...rows.filter(x=>x.candidate).map(x=>({key:String(x.no),actor:x.no,weight:Math.max(.04,x.gain),feasibility:'unknown'}))]};
 }
 function applyLater(s,no,phase,move){
  const reviewed=laterOptions(s,phase),row=reviewed.rows.find(x=>x.no===no);
  if(no){if(!row?.candidate)throw Error('後半の反撃が現位置から成立しません');const c=row.candidate;move(s,c.members,c.to-1,phase+'の攻防を利用し直前の別線一組を越える');s.energy[no]=Math.min(.95,s.energy[no]+.12);for(const n of c.members.slice(1))s.energy[n]=Math.min(.95,s.energy[n]+.04);}
  s.reactionLog=[...(s.reactionLog||[]),{phase,actor:no||null,action:no?'counter':'wait',rows:reviewed.rows.map(x=>({no:x.no,reason:x.reason,selected:x.no===no}))}];
 }
 function outsideOptions(s){const head=s.outside.filter(n=>n!==s.leader).sort((a,b)=>(s.energy[b]||0)-(s.energy[a]||0)||a-b)[0];return !head?[{key:'none',weight:1,feasibility:'allowed'}]:[{key:'continue',actor:head,weight:Math.max(.15,1-(s.energy[head]||0)),feasibility:'allowed'},{key:'retreat',actor:head,weight:.10+(s.energy[head]||0)*.45,feasibility:'allowed'}];}
 function applyOutside(s,choice,phase,move){if(!choice.actor)return;const no=choice.actor;if(choice.key==='retreat'){
  const members=contiguous(s,no).length?contiguous(s,no):[no],at=s.order.indexOf(no);s.outside=s.outside.filter(n=>n!==no);if(at<s.order.length-members.length){const next=s.order[at+members.length],line=lineOf.get(next),tail=s.order.slice(at+members.length).filter(n=>line.includes(n)).length;move(s,members,Math.min(s.order.length-members.length,at+Math.max(1,tail)),'不発の外並走を解消し直後の別線一組まで下げる');}
  s.energy[no]=Math.max(0,s.energy[no]-.035);s.recovery={...(s.recovery||{}),[no]:(s.recovery?.[no]||0)+1};
 }else s.energy[no]=Math.min(.95,s.energy[no]+.055);
 s.reactionLog=[...(s.reactionLog||[]),{phase,actor:no,action:choice.key==='retreat'?'retreat':'outside-continue',rows:[]}];}
 function closing(s,phase){const entries=(s.reactionLog||[]).filter(x=>x.phase===phase),parts=[];for(const e of entries){if(e.action==='counter')parts.push(who(e.actor)+'は前の攻防を利用し、直前の別線を越えて'+position(s.order,e.actor)+'番手へ上がる');if(e.action==='retreat')parts.push(who(e.actor)+'は外で踏み続けず、一度下げて脚を立て直す');}return parts.length?parts.join('。')+'。':'';}
 function snapshot(s,index,previous){
  const before=previous?.order||s.order,after=s.order,stage=index+1;
  const leaderAt=(order,l)=>position(order,l[0]),rows=lines.map(l=>{
   const no=l[0],from=leaderAt(before,l),to=leaderAt(after,l);
   let action='待機',cause='位置を保って次の仕掛けに備える';
   if(stage===1){action='初手の位置取り';cause='S取りで決まった初手の隊列に収まる';}
   else if(stage===2){
    if(no===s.attacker){action=s.outcome==='attacker-takes'?'主導権奪取':'仕掛け不発・立て直し';cause=action==='主導権奪取'?'前受けを越える':'前受けに突っ張られ、出切れず後退する';}
    else if(no===s.front){action=s.outcome==='attacker-takes'?(s.stand==='yield'?'出させて下げる':'主導権を奪われる'):'突っ張り';cause=action==='突っ張り'?'前を譲らずに踏み返す':action==='主導権を奪われる'?'突っ張ったが出切られる':'別線を出させて巻き返しを狙う';}
    else if(no===s.redThird){action='攻防を利用した位置上昇';cause='前の別線を一組だけ越える';}
    else {action='反応を見て待機';cause='先頭の攻防に無理に加わらない';}
   }else if(stage===3||stage===4){
    const actor=stage===3?s.homeRider:s.backRider;
    if(no===actor){action='仕掛け';cause=stage===3?'ホームからのロング捲り':'バックでの巻き返し';}
    else if(no===s.leader){action='主導権維持';cause='先頭でペースを作る';}
    else if(to>from){action='後退';cause='先に仕掛けたラインの進出で位置を下げる';}
   }else if(stage===5){
    if(no===s.cornerRider){action='捲り';cause='コーナーで外を進む';}
    else if(no===s.leader){action='先行の踏み直し';cause='主導権を保って直線へ';}
    else if(to>from){action='後退';cause='前団の攻防で位置を下げる';}
   }else if(stage===6){action=to<from?'直線で進出':to>from?'直線で後退':'着順維持';cause='直線での決着';}
   const phaseKey={3:'home',4:'back',5:'late'}[stage],reply=(s.reactionLog||[]).filter(x=>x.phase===phaseKey).at(-1),assessment=reply?.rows?.find(x=>x.no===no);
   if(reply?.actor===no&&reply.action==='counter'){action='攻防を利用した位置上昇';cause='直前の別線を一組越え、次の仕掛けに備える';}else if(assessment&&action==='待機')cause=assessment.reason;
   if(s.frontResponse&&s.frontResponse.phase===phaseKey&&s.frontResponse.actor===no){action=s.frontResponse.choice==='resist'?'踏み直しで抵抗':action;cause=s.frontResponse.choice==='resist'?'仕掛けに合わせて踏み直し、主導権を守りにいく':cause;}
   return {line:[...l],leader:no,from,to,action,cause,changed:to!==from};
  });
  const riders=r.riders.slice().sort((a,b)=>a.no-b.no).map(x=>{
   const from=position(before,x.no),to=position(after,x.no),head=lineOf.get(x.no)[0];
   const status=stage===6?(to<from?'直線で進出':to>from?'直線で交わされる':'着順維持'):
    stage===2&&x.no===s.redThird?'攻防を利用して進出':
    stage===2&&x.no===s.attacker?(s.outcome==='attacker-takes'?'主導権奪取':'仕掛け不発'):
    to<from?'位置を上げる':to>from?'位置を下げる':
    s.connected?.[x.no]===false?'追走離れ':x.no!==head?'ラインを追走':'位置を維持';
   return {no:x.no,name:x.name,lineHead:head,from,to,status,connected:s.connected?.[x.no]!==false};
  });
  const unique=new Set(rows.flatMap(x=>x.line));
  if(unique.size!==r.riders.length||rows.length!==lines.length)throw Error('全ラインの反応記録が欠落しました');
  return {schema:'tk-line-reactions/v1',stage,rows,riders,third:s.redThird||null,unresolvedLocation:false};
 }
 function redClosing(s){
  const clauses=[];
  if(s.attacker&&s.outcome!=='attacker-takes'){
   const pos=position(s.order,s.attacker);
   clauses.push(who(s.attacker)+'は前に出切れず、'+pos+'番手で態勢を立て直す');
  }
  if(s.redThird){
   clauses.push(who(s.redThird)+'は前の攻防を利用して'+who(s.redThirdAhead)+'のラインを越え、'+position(s.order,s.redThird)+'番手へ上がる');
  }
  return clauses.length?clauses.join('。')+'。':'';
 }
 function homeClosing(s,previous){
  if(!s.homeRider||s.homeResult!=='takes'||!previous)return '';
  const beaten=previous.order[0],after=position(s.order,beaten);
  return beaten!==s.homeRider&&after>1?who(beaten)+'は'+after+'番手へ下がる。':'';
 }
 return {counters,applyCounter,laterOptions,applyLater,outsideOptions,applyOutside,closing,snapshot,redClosing,homeClosing};
}
const api={build};if(typeof module!=='undefined')module.exports=api;root.LineReactions=api;
})(typeof globalThis!=='undefined'?globalThis:this);
