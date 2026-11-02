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
   return {line:[...l],leader:no,from,to,action,cause,changed:to!==from};
  });
  const unique=new Set(rows.flatMap(x=>x.line));
  if(unique.size!==r.riders.length||rows.length!==lines.length)throw Error('全ラインの反応記録が欠落しました');
  return {schema:'tk-line-reactions/v1',stage,rows,third:s.redThird||null,unresolvedLocation:false};
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
 return {counters,applyCounter,snapshot,redClosing,homeClosing};
}
const api={build};if(typeof module!=='undefined')module.exports=api;root.LineReactions=api;
})(typeof globalThis!=='undefined'?globalThis:this);
