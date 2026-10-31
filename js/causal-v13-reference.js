
/* TK KEIRIN LAB v1.3 - explicit causal-state event branching.
   Each scenario has a distinct physical sequence. Ratings are heuristic plausibility scores,
   NOT probabilities. Missing B/S/recent data is never interpreted as actual 0.
*/
const CAUSAL_V='causal-states-v1.3.0';
let causalLast=null;
const causalEsc=x=>esc(x);
const causalClip=(v,a,b)=>Math.max(a,Math.min(b,v));
function causalBuild(r,profileOverrides=null){
 validate(r);
 const profiles=brainProfiles(r);
 if(profileOverrides)for(const [no,delta] of profileOverrides){if(profiles.has(no))profiles.set(no,{...profiles.get(no),...delta});}
 const players=new Map(r.riders.map(x=>[x.no,x]));
 const lineOf=new Map(),posOf=new Map();
 r.lineup.forEach((line,i)=>line.forEach((no,j)=>{lineOf.set(no,i);posOf.set(no,j);}));
 const missing=Boolean(r.source?.missing_fields?.includes('b_s_recent')||r.riders.some(x=>x.meta?.absent_fields?.includes('b')));
 const tr=(n,k)=>brainTrait(profiles.get(n),k)/5;
 const ab=n=>causalClip(.7+.06*(players.get(n).score-(r.riders.reduce((t,x)=>t+x.score,0)/r.riders.length)),.5,1.5);
 const baseFront=n=>.25+.65*tr(n,'front')+(missing?0:.06*Math.min(5,players.get(n).s));
 const leaders=r.lineup.map(x=>x[0]);
 const orderedFront=leaders.slice().sort((a,b)=>baseFront(b)-baseFront(a)||a-b).slice(0,Math.min(3,leaders.length));
 const narratives=[];
 function thirdChoice(a,b,preferred=null){
  const rest=r.riders.filter(x=>!([a,b].includes(x.no)));
  rest.sort((x,y)=>{
   const f=z=>.36*ab(z.no)+.24*tr(z.no,'finish')+.14*tr(z.no,'outer')+.18*(lineOf.get(z.no)===lineOf.get(b)?1:0)+.22*(z.no===preferred?1:0);
   return f(y)-f(x)||x.no-y.no;
  });
  return rest[0]?.no;
 }
 function chooseSeat(controller,missed,front,attacker){
  const rest=r.riders.filter(x=>x.no!==controller&&x.no!==missed&&lineOf.get(x.no)!==lineOf.get(controller));
  rest.sort((x,y)=>{
   const f=z=>.32*tr(z.no,'seat')+.22*ab(z.no)+.20*(z.no===front?1:0)+.12*(posOf.get(z.no)===0?1:0);
   return f(y)-f(x)||x.no-y.no;
  });
  return rest[0]?.no||null;
 }
 function addPath(obj){
  const {first,second,third}=obj;
  if(!Number.isInteger(first)||!Number.isInteger(second)||!Number.isInteger(third)||new Set([first,second,third]).size!==3)return;
  const riders=[first,second,third];
  const physical=obj.states;
  if(physical.length!==5)throw Error('因果系列に必要な5局面がありません');
  const score=Math.max(1e-9,obj.score)*(.62+.14*ab(first)+.11*tr(first,'finish'));
  narratives.push({...obj,key:riders.join('-'),trio:riders,score,rare:['seat','recovery','outer','duel'].includes(obj.mode)});
 }
 for(const front of orderedFront){
  const fline=r.lineup[lineOf.get(front)];
  for(const attacker of leaders){
   if(attacker===front)continue;
   const aline=r.lineup[lineOf.get(attacker)];
   const frontE=baseFront(front), attackA=ab(attacker);
   for(const stand of ['resist','yield']){
    const standW=stand==='resist'?.34+.65*tr(front,'resist'):.34+.65*tr(front,'withdraw');
    for(const tactic of ['kamashi','makuri']){
     const attackW=tactic==='kamashi'?.38+.70*tr(attacker,'kamashi'):.36+.68*tr(attacker,'makuri');
     // The attacker may fail when the front rider resists, or get over the top despite resistance.
     const contests=stand==='resist'?['front-holds','attacker-takes']:['attacker-takes'];
     for(const outcome of contests){
      const controller=outcome==='front-holds'?front:attacker;
      const cline=r.lineup[lineOf.get(controller)];
      const follower=cline[1]||null;
      const third=cline[2]||null;
      const gapModes=follower?['holds','breaks']:(['solo']);
      for(const gap of gapModes){
       const pursuit=follower?tr(follower,'track'):0;
       const burst=tr(controller,'kamashi');
       const keepW=causalClip(.48+.44*pursuit-.19*burst,.16,.86);
       const gapW=gap==='holds'?keepW:gap==='breaks'?1-keepW:1;
       const seat=gap==='breaks'?chooseSeat(controller,follower,front,attacker):null;
       const otherLeader=(controller===attacker?front:attacker);
       const action=stand==='resist'?'突っ張って抵抗':'引いて立て直し';
       const attackText=tactic==='kamashi'?'打鐘から一気にカマシ':'中団を狙って遅めに捲り';
       const controlText=outcome==='front-holds'?`${front}番が先頭を守った`:`${attacker}番が出切り${controller}番が先頭に立つ`;
       const gapText=gap==='holds'?`${follower}番が${controller}番に追走成功`:gap==='breaks'?`${follower}番が${controller}番の踏み出しで離れる`:`${controller}番は単騎で進出`;
       const phases=[`周回：${front}番が前受け。${attacker}番のラインは後方`,
         `打鐘：${front}番は${action}、${attacker}番は${attackText}`,
         `最終ホーム：${controlText}。${gapText}`,
         `最終バック：`];
       const commonW=frontE*standW*attackW*gapW*(outcome==='front-holds'?.59+.25*tr(front,'resist'):.60+.30*attackA);
       function path(mode,a,b,c,finishW,backText,straight){
        // Model several possible third-place closers without inventing a specific rider's outcome.
        const possible=[c,...r.riders.map(x=>x.no).filter(x=>![a,b,c].includes(x))]
          .filter((x,i,arr)=>Number.isInteger(x)&&![a,b].includes(x)&&arr.indexOf(x)===i).slice(0,3);
        possible.forEach((thirdNo,i)=>addPath({mode,leader:controller,front,attacker,stand,tactic,gap,seat,
         first:a,second:b,third:thirdNo,score:commonW*finishW*Math.pow(.64,i),
         states:[...phases.slice(0,3),`最終バック：${backText}`,`直線：${straight}。${thirdNo}番を３着候補に想定`],
         explanation:`${front}番の${stand==='resist'?'突っ張り':'引き'}、${attacker}番の${tactic==='kamashi'?'カマシ':'捲り'}、${follower?`${follower}番の${gap==='holds'?'追走':'千切れ'}`:'単騎進出'}が分岐を決める`}));
       }
       // A line lead, follower passing, rival closing from outside, or dislocated rider taking the vacant spot.
       const lead2=gap==='holds'?follower:(seat||otherLeader);
       path('lead',controller,lead2,thirdChoice(controller,lead2,third),.40+.43*ab(controller),
        `${controller}番が主導権を維持。${gap==='breaks'?`${seat||'別線'}番が空いた番手付近を狙う`:'先頭ラインが直線へ'}`,
        `${controller}番が押し切る`);
       if(gap==='holds'){
        path('sashi',follower,controller,thirdChoice(follower,controller,third),.38+.64*tr(follower,'finish'),
         `${controller}番が先頭、${follower}番が番手で脚をためる`,
         `${follower}番が差し切り、${controller}番が残る`);
        if(third){
         path('third',third,follower,controller,.21+.45*tr(third,'finish'),
          `${third}番が３番手で脚を温存`,`${third}番が直線で前二人を差し切る`);
        }
       }
       if(gap==='breaks'&&seat){
        path('seat',seat,controller,thirdChoice(seat,controller,front),.27+.52*tr(seat,'seat')+.28*tr(seat,'finish'),
         `${follower}番が離れ、${seat}番が空いた番手付近に収まる`,
         `${seat}番が即席番手から差し切る`);
        path('chaser',controller,seat,thirdChoice(controller,seat,front),.25+.33*tr(seat,'seat'),
         `${follower}番が離れ、${seat}番が${controller}番の後ろを追う`,`${controller}番が粘り、${seat}番が連対する`);
       }
       // A third-line rider can recover from separation by switching to independent attack.
       if(third && gap==='holds'){
        path('recovery',third,controller,thirdChoice(third,controller,otherLeader),.14+.32*tr(third,'recover')+.20*tr(third,'outer'),
         `${third}番が連係から遅れ、自力に切り替え外へ進路を探す`,
         `${third}番が捲り追い込みで突っ込む`);
       }
       // Outer closer must come from different line from the controller and not be the controller's follower.
       const outs=leaders.filter(n=>n!==controller&&n!==attacker&&n!==front).concat([otherLeader]);
       const outer=outs.filter(n=>n!==controller&&n!==follower).sort((a,b)=>tr(b,'outer')+ab(b)*.20-tr(a,'outer')-ab(a)*.20||a-b)[0];
       if(outer){
        path('outer',outer,controller,thirdChoice(outer,controller,follower),.16+.38*tr(outer,'outer')+.19*tr(outer,'makuri'),
         `${outer}番が先頭争いを見ながら大外へ持ち出す`,
         `${outer}番が大外を伸びて逆転`);
       }
       if(outcome==='front-holds'&&gap==='breaks'){
        path('duel',attacker,controller,thirdChoice(attacker,controller,front),.18+.32*tr(attacker,'recover'),
         `${controller}番の抵抗で隊列が乱れ、${attacker}番が外から再加速`,
         `${attacker}番が後方から捲り追い込む`);
       }
      }
     }
    }
   }
  }
 }
 if(!narratives.length)throw Error('展開分岐を構築できません');
 narratives.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
 const ticketsMap=new Map();
 for(const n of narratives){let t=ticketsMap.get(n.key);if(!t){t={key:n.key,trio:n.trio,score:0,paths:[],rare:false};ticketsMap.set(n.key,t);} t.score+=n.score;t.paths.push(n);t.rare ||=n.rare;}
 const tickets=[...ticketsMap.values()].sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
 const rare=tickets.filter(t=>t.rare&&t.paths.some(p=>p.rare&&p.score/t.score>.35));
 const chosen=[],used=new Set();
 for(const t of tickets){if(chosen.length===16)break;chosen.push(t);used.add(t.key);}
 for(const t of rare){if(chosen.length===20)break;if(!used.has(t.key)){chosen.push(t);used.add(t.key);}}
 for(const t of tickets){if(chosen.length===20)break;if(!used.has(t.key)){chosen.push(t);used.add(t.key);}}
 // A keyman is a rider whose ALTERNATIVE DECISION changes the predicted winner,
 // not just someone who appears frequently in narratives.
 const totalWeight=narratives.reduce((z,x)=>z+x.score,0)||1;
 function conditionalWin(arr){
  const total=arr.reduce((z,x)=>z+x.score,0);const dist=new Map();
  if(total>0)for(const x of arr)dist.set(x.first,(dist.get(x.first)||0)+x.score/total);
  return {dist,total,leader:[...dist].sort((a,b)=>b[1]-a[1])[0]?.[0]||null};
 }
 function contrast(no,label,aa,bb){
  if(!aa.length||!bb.length)return null;
  const a=conditionalWin(aa),b=conditionalWin(bb),keys=new Set([...a.dist.keys(),...b.dist.keys()]);
  const difference=[...keys].reduce((sum,n)=>sum+Math.abs((a.dist.get(n)||0)-(b.dist.get(n)||0)),0)/2;
  // Distributional change, tempered by how much of the generated tree discusses this decision.
  const support=causalClip((a.total+b.total)/totalWeight,0,1);
  return {no,name:players.get(no).name,score:difference*Math.sqrt(support),decisions:[label,`分岐ごとの１着候補 ${a.leader??'―'}番 → ${b.leader??'―'}番`],outcomes:keys.size};
 }
 const pivots=[];
 for(const n of orderedFront){
  const universe=narratives.filter(x=>x.front===n);
  const pivot=contrast(n,'突っ張るか／引くか',universe.filter(x=>x.stand==='resist'),universe.filter(x=>x.stand==='yield'));
  if(pivot)pivots.push(pivot);
 }
 for(const n of leaders){
  const universe=narratives.filter(x=>x.attacker===n);
  const pivot=contrast(n,'カマシか／遅い捲りか',universe.filter(x=>x.tactic==='kamashi'),universe.filter(x=>x.tactic==='makuri'));
  if(pivot)pivots.push(pivot);
 }
 for(const line of r.lineup){
  if(line.length<2)continue;
  const n=line[1],universe=narratives.filter(x=>r.lineup[lineOf.get(x.leader)][1]===n);
  const pivot=contrast(n,'番手が追走するか／離れるか',universe.filter(x=>x.gap==='holds'),universe.filter(x=>x.gap==='breaks'));
  if(pivot)pivots.push(pivot);
 }
 const pivotBest=new Map();
 for(const p of pivots){if(!pivotBest.has(p.no)||p.score>pivotBest.get(p.no).score)pivotBest.set(p.no,p);}
 const keymen=[...pivotBest.values()].sort((a,b)=>b.score-a.score||a.no-b.no).slice(0,3);
 return {version:CAUSAL_V,race:{date:r.date,venue:r.venue,race_no:r.race_no,start:r.start},missing,narratives,tickets,chosen,keymen,front:orderedFront[0],dataSource:r.source?.label||'手入力または試作データ'};
}
function causalRun(){
 try{
  const out=causalBuild(data);causalLast=out;
  const top=out.keymen;
  $('causal-state').textContent=`${out.race.date} ${out.race.venue}${out.race.race_no}R｜${out.narratives.length}展開分岐、${out.tickets.length}買い目候補から20点選定。${out.missing?'B/S・直近成績は未提供（人物仮説の推定値で補助）':'選手データを反映'}。`;
  $('causal-top').innerHTML=top.map((x,i)=>`<div class="causal-k"><small>${i===0?'最重要キーマン':'変動要因'+(i+1)}</small><strong>${x.no}番 ${causalEsc(x.name)}</strong><span>${causalEsc(x.decisions.slice(0,3).join(' ／ '))}</span></div>`).join('');
  $('causal-keymen').innerHTML=top.map(x=>`<div class="line"><strong>${x.no}番 ${causalEsc(x.name)}</strong>：${causalEsc(x.decisions.filter(z=>z!=='直線の決着').slice(0,3).join('・'))}</div>`).join('');
  const seen=new Set(),stories=[];
  for(const n of out.narratives){const identity=`${n.mode}:${n.front}:${n.attacker}:${n.stand}:${n.gap}`;if(seen.has(identity))continue;seen.add(identity);stories.push(n);if(stories.length===5)break;}
  for(const type of ['seat','recovery','outer']){const alt=out.narratives.find(x=>x.mode===type&&!stories.some(s=>s.mode===type));if(alt)stories.push(alt);}
  $('causal-stories').innerHTML=stories.map((n,i)=>`<details class="causal-story" ${i===0?'open':''}><summary><strong>${i+1}. ${n.key}</strong>　${causalEsc(n.mode==='seat'?'番手はまり':n.mode==='recovery'?'３番手の再自力':n.mode==='outer'?'大外の強襲':n.mode==='sashi'?'番手差し':n.mode==='third'?'３番手の差し':n.mode==='lead'?'先頭の押し切り':'追走崩れ')}</summary><ol>${n.states.map(v=>`<li>${causalEsc(v)}</li>`).join('')}</ol><p class="hyp">仮説の分岐：${causalEsc(n.explanation)}（相対評価。確率ではない）</p></details>`).join('');
  $('causal-tickets').innerHTML=out.chosen.map((t,i)=>{const p=t.paths.slice().sort((a,b)=>b.score-a.score)[0];return `<div class="causal-ticket"><strong>${i+1}. ${causalEsc(t.key)}</strong><span>${causalEsc(p.mode==='seat'?'番手はまり':p.mode==='recovery'?'再自力':p.mode==='outer'?'大外強襲':p.mode==='sashi'?'差し':'主導権・別筋')}${i>=16?' ✦ 穴枠':''}</span></div>`;}).join('');
  return out;
 }catch(e){$('causal-state').textContent='展開推理のエラー：'+e.message;causalLast=null;return null;}
}
$('causal-run').addEventListener('click',causalRun);
$('causal-copy').addEventListener('click',async()=>{
 if(!causalLast)causalRun();if(!causalLast)return;
 const s=`${causalLast.race.date} ${causalLast.race.venue}${causalLast.race.race_no}R 展開推理\n`+causalLast.chosen.map((x,i)=>`${i+1}. ${x.key}`).join('\n');
 try{await navigator.clipboard.writeText(s);$('causal-state').textContent+='\n買い目をコピーしました。';}catch(e){window.prompt('買い目をコピーしてください',s);}
});
$('causal-export').addEventListener('click',()=>{
 if(!causalLast)causalRun();if(!causalLast)return;
 const o={schema:'tk-keirin-causal/v1.3',generated_at:new Date().toISOString(),...causalLast};
 const blob=new Blob([JSON.stringify(o,null,2)],{type:'application/json'}),link=URL.createObjectURL(blob),a=document.createElement('a');a.href=link;a.download='TK_KEIRIN_CAUSAL_'+causalLast.race.date+'_'+causalLast.race.venue+causalLast.race.race_no+'R.json';a.click();setTimeout(()=>URL.revokeObjectURL(link),10000);
});
const causalOldRender=render;render=function(){causalOldRender();causalRun();};
causalRun();
