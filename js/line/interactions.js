/* Conditional line counterplay, recovery, competition and route creation. */
(function(root){'use strict';
const State=typeof module!=='undefined'?require('./state.js'):root.LineState;
function create(env){
 const {lines,topology,r,f,ev,event,term,move,who,allocate,setContext}=env,copy=State.clone;
 function advance(t){t.id=allocate();return t;}
 const members=(s,id)=>State.members(s,id,lines),control=s=>State.project(s,lines).control;
 function homeFailure(s){
  setContext(s);const result=[s];if(!s.outside||s.scenes.length!==2)return result;
  const t=advance(copy(s)),a=t.outside;t.failedAttacks=t.failedAttacks||[];t.failedAttacks.push({...a,stage:2,status:'failed'});t.outside=null;
  // The failed move gives no free improvement in the inner order.
  t.burden[a.id]++;event(t,a.id,'stalled',`${who(a.id)}はホームの加速で前団に届かず、一度仕掛けを止める。元の位置から立て直しを待つ`);
  term(t,'feasibility',.35-f(lines[a.id].head,'sprint'),'ホームで仕掛けが不発になる帰結も比較',[ev(lines[a.id].head,'sprint')]);
  t.assumptions.push(`${who(a.id)}の不発後は位置と残る脚を再確認し、自動的な再浮上を置かない`);result.push(t);return result;
 }
 function recovery(s){
  setContext(s);const result=[s];
  for(const a of s.failedAttacks||[]){if(a.status!=='failed'||a.stage>=s.scenes.length||s.outside?.id===a.id)continue;
   const h=lines[a.id].head;if(f(h,'recover')<.45||s.burden[a.id]>5)continue;
   const t=advance(copy(s));t.failedAttacks.find(x=>x.id===a.id).status='reset';t.recoveredLines=[...(t.recoveredLines||[]),a.id];
   event(t,a.id,'recover',`${who(a.id)}は不発直後に無理な二の脚を使わず、内の位置を確保して立て直す。再仕掛けには次の空いた進路が必要`);
   term(t,'rationality',f(h,'recover')-.2,'不発後の再攻撃より立て直す利益を比較',[ev(h,'recover')]);result.push(t);
   const at=s.order.indexOf(a.id),lead=control(s);
   if(at>0&&at<=2&&!s.outside&&f(h,'recover')>=.5&&f(h,'makuri')>=.5){const retry=advance(copy(t));retry.used=retry.used.filter(id=>id!==a.id);retry.retry=a.id;retry.burden[a.id]++;
    retry.outside={id:a.id,anchor:lead,progress:'不発後に中団外から仕掛け直す',kind:'relaunch',from:at,started:s.scenes.length};retry.attacks.push({id:a.id,kind:'relaunch',from:at,phase:s.scenes.length,after_failure:true});
    event(retry,a.id,'relaunch',`${who(a.id)}は中団近くの位置と立て直しの根拠を使い、短く再加速する。前団は踏み直して迎え撃つ`);
    retry.burden[lead]++;term(retry,'feasibility',f(h,'recover')+f(h,'makuri')*.3-s.burden[a.id]*.12,'不発の負担を差し引いた再仕掛け',[ev(h,'recover'),ev(h,'makuri')]);result.push(retry);
   }
  }
  for(const no of s.detached){if(s.recoveredRiders?.includes(no)||f(no,'recover')<.5)continue;
   const origin=topology.lines.find(l=>l.members.includes(no)).id,at=s.order.indexOf(origin);if(at<0||at>2)continue;
   const t=advance(copy(s)),tail=t.detached.filter(n=>n!==no);t.detached=tail;t.switches[no]=origin;t.recoveredRiders=[...(t.recoveredRiders||[]),no];t.riderBurden={...(t.riderBurden||{}),[no]:(t.riderBurden?.[no]||0)+2};
   event(t,origin,'reconnect',`${no}番は離れた直後の位置差を残しつつ、立て直して元ラインの最後尾へ追い付く。残っている隊列の末尾に付く`);
   t.rearJoins=[...(t.rearJoins||[]),no];term(t,'feasibility',f(no,'recover')-.45,'追走離れ→立て直し→末尾への復帰を別の局面で接続',[ev(no,'recover')]);result.push(t);
  }return result;
 }
 function counter(s){
  setContext(s);const result=[s];if(!s.outside||s.secondary)return result;
  const occupied=new Set(State.active(s).map(a=>a.id)),lead=control(s);
  for(const id of s.order.filter(id=>id!==lead&&!occupied.has(id)&&topology.active.includes(id)&&!s.used.includes(id))){
   const h=lines[id].head,at=State.project(s,lines).groups.filter(g=>g.lane===0&&g.members.length).findIndex(g=>g.id===id);if(at<0||at>2||f(h,'makuri')<.5)continue;
   const t=advance(copy(s));for(const a of State.active(t))a.followers=(a.followers||[]).filter(other=>other!==id);t.used.push(id);t.secondary={id,anchor:lead,progress:'別線の外から反撃する三列目',kind:'counter',from:at,started:s.scenes.length};t.burden[id]+=2;
   t.attacks.push({id,kind:'counter',from:at,phase:s.scenes.length,responding_to:s.outside.id});
   event(t,id,'counter',`${who(id)}は${who(s.outside.id)}の仕掛けで内の進路が詰まる前に、その外から反撃する。前団と攻撃中のラインも踏み続ける`);
   t.burden[lead]++;t.burden[s.outside.id]++;
   term(t,'interaction',.3,'進行中の捲りに別線が反応し、二つの外進行を同時に保持');
   term(t,'feasibility',f(h,'makuri')-.15-at*.12,'三列目の反撃は現在位置と加速の根拠に制限',[ev(h,'makuri'),ev(h,'ability')]);
   t.assumptions.push(`${who(id)}は二列目の仕掛けが止まる場合にも三列目を踏み続ける負担を負う`);result.push(t);
  }return result;
 }
 function contest(s,stage){
  setContext(s);const result=[];
  const declared=(r.contests||[]).map(c=>({...c,target:topology.lines.find(l=>l.head===c.leader).id,declared:true}));
  const base=s.contest?[s.contest]:stage===1?declared:[];
  if(!base.length)return [s];
  // Multiple declarations are applied in order with a bounded local beam.
  let states=[s];for(const c of base){const next=[];
   for(const source of states){for(const outcome of stage===1?['unresolved','held','won']:['held','won']){
    const t=advance(copy(source)),target=c.target,incumbent=c.incumbent,challenger=c.challenger;if(!members(t,target).includes(incumbent)&&outcome!=='unresolved')continue;
    t.contest={...c,outcome};t.contestHistory=[...(t.contestHistory||[]),{challenger,incumbent,target,outcome,phase:stage}];t.burden[target]++;t.riderBurden={...(t.riderBurden||{}),[incumbent]:(t.riderBurden?.[incumbent]||0)+1,[challenger]:(t.riderBurden?.[challenger]||0)+1};
    if(outcome==='won'){
     t.switches[challenger]=target;t.switches[incumbent]=target;t.rearJoins=[...(t.rearJoins||[]),incumbent];t.contest=null;
     event(t,target,'seat_won',`${challenger}番は${incumbent}番との競りを制して番手を確保。${incumbent}番は最後尾へ下がって連結を立て直す`,{outcome});
    }else if(outcome==='held'){
     t.contest=null;event(t,target,'seat_held',`${incumbent}番は番手を守り、${challenger}番は番手を取れず元の位置で立て直す`,{outcome});
    }else event(t,target,'seat_partial',`${challenger}番と${incumbent}番の番手競りは決着せず、両者の追走負担が増える`,{outcome});
    const diff=f(challenger,'position')-f(incumbent,'track');term(t,'feasibility',outcome==='won'?diff:outcome==='held'?-diff:.12-Math.abs(diff),'競りは位置取りと追走の双方の裏付けから勝敗・継続を別評価',[ev(challenger,'position'),ev(incumbent,'track')]);
    term(t,'robustness',outcome==='won'&&diff<0?-.4:outcome==='unresolved'?-.15:0,'競り成功を都合よく連続させる前提を抑制');next.push(t);
   }}states=next.slice(0,12);
  }result.push(...states);return result.length?result:[s];
 }
 function inside(s){
  setContext(s);const result=[s];if(s.innerRoute)return result;
  const defenses=[...(s.defenses||[]),...(s.defense?[s.defense]:[])].filter(d=>d.action==='block');if(!defenses.length)return result;
  const p=State.project(s,lines),lead=p.control,group=p.groups.find(g=>g.id===lead),blocker=defenses.at(-1).actor;
  const opportunity=p.order.filter(n=>n!==lines[lead].head&&n!==blocker&&p.positions[n]?.band==='inner'&&p.positions[n].ordinal>=2&&p.positions[n].ordinal<=4&&!s.detached.includes(n));
  for(const no of opportunity){if(f(no,'inside')<.42)continue;
   const t=advance(copy(s));t.innerRoute={no,target:lead,opened_by:blocker,from:p.order.indexOf(no),stage:s.scenes.length};t.riderBurden={...(t.riderBurden||{}),[no]:(t.riderBurden?.[no]||0)+1};
   event(t,lead,'inside',`${no}番は${blocker}番が外へ牽制して開いた内の進路へ入る。内側の前走者は縦に踏み、無条件には抜かせない`);
   term(t,'feasibility',f(no,'inside')*.45+f(no,'finish')*.25-.2,'内進路の発生・近い位置・直線伸びを同時に確認',[ev(no,'inside'),ev(no,'finish')]);
   t.assumptions.push(`${no}番の内進出には、${blocker}番の牽制でできた進路が閉じないことが必要`);result.push(t);
  }return result;
 }
 return {homeFailure,recovery,counter,contest,inside};
}
const api={create};if(typeof module!=='undefined')module.exports=api;root.LineInteractions=api;
})(typeof globalThis!=='undefined'?globalThis:this);
