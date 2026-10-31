/* Independent state-transition engine. No legacy picks, manual profiles or seed personalities. */
(function(root){
'use strict';
const VERSION='independent-causal-v1.4.0';
const clip=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const nameKey=s=>String(s).replace(/[\s\u3000]/g,'');
const TRAITS=['front','resist','withdraw','kamashi','makuri','track','seat','recover','finish','outer'];
function profiles(r,pack={}){
 const cutoff=Date.parse(`${r.date}T${r.start}:00+09:00`);
 return new Map(r.riders.map(x=>{
  const own=x.style!=='追', absent=new Set([...(x.meta?.absent_fields||[]),...(r.source?.missing_fields?.includes('b_s_recent')?['s','b']:[])]);
  const p={front:.4,resist:own?.55:.22,withdraw:.5,kamashi:own?.6:.2,makuri:own?.6:.22,track:.55,seat:.45,recover:own?.55:.3,finish:clip(.45+(x.score-100)*.012,.2,.8),outer:own?.5:.35,evidence:[],basis:'脚質・得点による暫定値'};
  if(!absent.has('s')&&Number.isFinite(x.s))p.front=clip(.3+x.s*.045,.2,.85);
  if(!absent.has('b')&&Number.isFinite(x.b)&&own){p.resist=clip(.4+x.b*.025,.3,.85);p.kamashi=clip(.5+x.b*.015,.35,.85);}
  const rows=(pack.evidence||[]).filter(e=>nameKey(e.rider)===nameKey(x.name)&&TRAITS.includes(e.trait)&&Number.isFinite(e.value)&&e.value>=0&&e.value<=1&&Number.isFinite(e.confidence)&&e.confidence>0&&/^https:\/\//.test(e.url||'')&&e.body_verified===true&&Date.parse(e.published_at)<cutoff&&Date.parse(e.collected_at)<cutoff);
  for(const k of TRAITS){
   const es=rows.filter(e=>e.trait===k),dedup=new Map();
   for(const e of es){const old=dedup.get(e.url);if(!old||e.confidence>old.confidence)dedup.set(e.url,e);}
   let total=1.8,sum=p[k]*total;
   for(const e of dedup.values()){
    const age=Math.max(0,(cutoff-Date.parse(e.published_at))/86400000),w=clip(e.confidence)*Math.exp(-age/270);
    sum+=w*e.value;total+=w;p.evidence.push(e);
   }
   p[k]=clip(sum/total,.08,.92);
  }
  if(p.evidence.length)p.basis=`公開記事本文 ${new Set(p.evidence.map(e=>e.url)).size}件（自動抽出）`;
  return [x.no,p];
 }));
}
function build(r,pack={},forced=null){
 const ids=r.riders.map(x=>x.no),valid=new Set(ids);
 if(![7,9].includes(ids.length)||valid.size!==ids.length||r.lineup.flat().length!==ids.length||new Set(r.lineup.flat()).size!==ids.length||r.lineup.some(l=>!l.length)||r.lineup.flat().some(n=>!valid.has(n)))throw Error('7車・9車の全選手を並びに一度ずつ指定してください');
 const p=profiles(r,pack),by=new Map(r.riders.map(x=>[x.no,x])),leaders=r.lineup.map(l=>l[0]),lineOf=new Map();
 r.lineup.forEach(l=>l.forEach(n=>lineOf.set(n,l)));
 const ability=n=>clip(.55+(by.get(n).score-100)*.025,.2,1.25);
 const move=(order,ns,at=0)=>{const rest=order.filter(n=>!ns.includes(n));rest.splice(at,0,...ns);return rest;};
 const narratives=[];
 const choices=(no,key,options)=>forced&&forced.no===no&&forced.key===key?options.filter(x=>x[0]===forced.value).map(x=>[x[0],1]):options;
 const snapshot=(phase,order,energy,action)=>({phase,order:[...order],energy:{...energy},action});
 for(const front of leaders){
  const fl=lineOf.get(front),others=r.lineup.filter(l=>l!==fl).sort((a,b)=>p.get(b[0]).front-p.get(a[0]).front||a[0]-b[0]);
  const initial=[...fl,...others.flat()],fw=.1+p.get(front).front;
  for(const attacker of leaders.filter(n=>n!==front)){
   const al=lineOf.get(attacker),distance=initial.indexOf(attacker)/ids.length;
   for(const [stand,sw] of choices(front,'stand',[['resist',p.get(front).resist],['yield',p.get(front).withdraw]])){
    for(const [tactic,tw] of choices(attacker,'tactic',[['kamashi',p.get(attacker).kamashi],['makuri',p.get(attacker).makuri]])){
     const takes=clip(.5+.3*(ability(attacker)-ability(front))+.2*p.get(attacker)[tactic]-(stand==='resist'?.22:0)-.08*distance,.12,.88);
     for(const [outcome,ow] of [['attacker-takes',takes],['front-holds',1-takes]]){
      const controller=outcome==='attacker-takes'?attacker:front,cl=lineOf.get(controller),follower=cl[1],third=cl[2];
      let order=outcome==='attacker-takes'?move(initial,al):[...initial];
      const energy=Object.fromEntries(ids.map(n=>[n,0]));
      energy[front]+=stand==='resist'?.34:.08;energy[attacker]+=(tactic==='kamashi'?.3:.2)+distance*.12;
      if(outcome==='front-holds')energy[attacker]+=.16;
      const base=[snapshot('周回',initial,Object.fromEntries(ids.map(n=>[n,0])),`${front}番が前受け。${attacker}番は${initial.indexOf(attacker)+1}番手から上昇`),snapshot('打鐘',stand==='yield'?move(initial,al):initial,energy,`${front}番は${stand==='resist'?'突っ張り':'引き'}を選択。${attacker}番は${tactic==='kamashi'?'カマシ':'脚をためて捲り'}を選択`)];
      // Acceleration stress depends on the actual current leader, speed and follower response.
      const keep=follower?clip(.48+.42*p.get(follower).track-.25*p.get(controller).kamashi-(stand==='resist'?.08:0),.18,.9):1;
      const gaps=follower?choices(follower,'gap',[['holds',keep],['breaks',1-keep]]):[['solo',1]];
      for(const [gap,gw] of gaps){
       let home=[...order],en={...energy},seat=null;
       if(gap==='breaks'){
        // A gap is filled by the nearest available rival, not the strongest unrelated rider.
        const ci=home.indexOf(controller),eligible=home.filter(n=>!cl.includes(n));
        seat=eligible.sort((a,b)=>Math.abs(home.indexOf(a)-ci)-Math.abs(home.indexOf(b)-ci)||p.get(b).seat-p.get(a).seat)[0];
        home=home.filter(n=>n!==follower);home.push(follower);en[follower]+=.25;
        if(seat)home=move(home,[seat],home.indexOf(controller)+1);
       }
       const homeSnap=snapshot('最終ホーム',home,en,`${controller}番が主導権。${gap==='breaks'?`${follower}番が追走離れ、${seat}番が空いた番手にはまる`:gap==='holds'?`${follower}番が追走を維持`:'単騎で進出'}`);
       const weight=fw*(.2+ability(attacker))*sw*tw*ow*gw;
       const emit=(mode,finisher,back,backEnergy,action,factor)=>{
        const rank=n=>ability(n)*.55+p.get(n).finish*.35-(backEnergy[n]||0)*.3-back.indexOf(n)*.025;
        const seconds=back.filter(n=>n!==finisher).sort((a,b)=>rank(b)-rank(a)||a-b).slice(0,3);
        for(const second of seconds)for(const thirdNo of back.filter(n=>![finisher,second].includes(n))){
         const finish=[finisher,second,thirdNo,...back.filter(n=>![finisher,second,thirdNo].includes(n))];
         const score=weight*factor*Math.exp(2.5*rank(second)+1.8*rank(thirdNo));
         const snapshots=[...base,homeSnap,snapshot('最終バック',back,backEnergy,action),snapshot('直線',finish,backEnergy,`${finisher}番が伸び、${second}番・${thirdNo}番へ。消耗と位置・差し脚から決着候補を生成`)];
         if(snapshots.some(s=>s.order.length!==ids.length||new Set(s.order).size!==ids.length))throw Error('隊列遷移の不整合');
         narratives.push({mode,front,attacker,stand,tactic,outcome,leader:controller,gap,seat,first:finisher,second,third:thirdNo,key:[finisher,second,thirdNo].join('-'),trio:[finisher,second,thirdNo],score,rare:['seat','recovery','outer'].includes(mode),snapshots,states:snapshots.map(s=>`${s.phase}：${s.action}【隊列 ${s.order.join('→')}】`),explanation:`${front}番の${stand==='resist'?'抵抗による消耗':'引いて温存'} → ${controller}番が主導権 → ${gap==='breaks'?'番手が空いて別線が利用':'追走隊列を維持'} → ${action}`});
        }
       };
       emit('lead',controller,home,en,`${controller}番が先頭を維持`,.35+ability(controller)*.4-en[controller]*.25);
       if(gap==='holds')emit('sashi',follower,home,en,`${follower}番は番手で脚をため差しを狙う`,.25+p.get(follower).finish*.55);
       if(gap==='breaks'&&seat)emit('seat',seat,home,en,`${seat}番が即席番手から差しを狙う`,.15+p.get(seat).seat*.3+p.get(seat).finish*.25);
       // The third rider first loses contact, then switches to an independent attack.
       if(third){
        let back=home.filter(n=>n!==third);back.push(third);const re={...en,[third]:(en[third]||0)+.26};
        emit('recovery',third,back,re,`${third}番が${gap==='breaks'?'前の離れで':'踏み直しで'}追走を失い後退。再自力に切り替えて外を捲る`,.06+p.get(third).recover*.25+p.get(third).makuri*.1);
       }
       const outer=home.filter(n=>!cl.includes(n)).sort((a,b)=>p.get(b).outer+ability(b)*.2-p.get(a).outer-ability(a)*.2)[0];
       if(outer){const oe={...en,[outer]:(en[outer]||0)+.2};emit('outer',outer,home,oe,`${outer}番が${stand==='resist'?'踏み合いによる前の消耗':'前団の仕掛け'}を見て大外へ持ち出し強襲`,.08+p.get(outer).outer*.25+en[controller]*.25);}
      }
     }
    }
   }
  }
 }
 if(!narratives.length)throw Error('独立した別線が必要です');
 narratives.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
 const map=new Map();for(const n of narratives){if(!map.has(n.key))map.set(n.key,{key:n.key,trio:n.trio,score:0,paths:[],rare:false});const t=map.get(n.key);t.score+=n.score;t.paths.push(n);t.rare||=n.rare;}
 const tickets=[...map.values()].sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
 const chosen=tickets.slice(0,16),used=new Set(chosen.map(t=>t.key));
 for(const mode of ['seat','recovery','outer']){const n=narratives.find(n=>n.mode===mode&&!used.has(n.key));if(n){chosen.push(map.get(n.key));used.add(n.key);}}
 for(const t of tickets){if(chosen.length===20)break;if(!used.has(t.key)){chosen.push(t);used.add(t.key);}}
 const distribution=ns=>{const m=new Map(),total=ns.reduce((s,n)=>s+n.score,0)||1;for(const n of ns)m.set(n.first,(m.get(n.first)||0)+n.score/total);return m;};
 // Matched contexts: each opposite decision is normalized within identical other decisions.
 // This avoids crediting a keyman merely for appearing in many branches.
 const pivots=[];
 for(const no of ids)for(const [key,label,a,b] of [['stand','突っ張るか／引くか','resist','yield'],['tactic','カマシか／捲りか','kamashi','makuri'],['gap','追走を維持するか／離れるか','holds','breaks']]){
  const role=key==='stand'?'front':key==='tactic'?'attacker':'follower';
  const relevant=narratives.filter(n=>role==='follower'?lineOf.get(n.leader)[1]===no:n[role]===no);
  const groups=new Map();for(const n of relevant){const context=[n.front,n.attacker,...['stand','tactic','gap'].filter(k=>k!==key).map(k=>n[k])].join('|');if(!groups.has(context))groups.set(context,[[],[]]);const k=n[key]===a?0:n[key]===b?1:-1;if(k>=0)groups.get(context)[k].push(n);}
  let diff=0,count=0;const da=new Map(),db=new Map();
  for(const [aa,bb] of groups.values()){if(!aa.length||!bb.length)continue;const ad=distribution(aa),bd=distribution(bb);diff+=ids.reduce((s,n)=>s+Math.abs((ad.get(n)||0)-(bd.get(n)||0)),0)/2;for(const n of ids){da.set(n,(da.get(n)||0)+(ad.get(n)||0));db.set(n,(db.get(n)||0)+(bd.get(n)||0));}count++;}
  if(count){const winner=d=>[...d].sort((x,y)=>y[1]-x[1])[0][0];pivots.push({no,name:by.get(no).name,score:diff/count,decisions:[label,`対になる${count}条件を比較：１着候補 ${winner(da)}番 → ${winner(db)}番`],matched_contexts:count});}
 }
 const best=new Map();for(const x of pivots)if(!best.has(x.no)||best.get(x.no).score<x.score)best.set(x.no,x);
 const keymen=[...best.values()].sort((a,b)=>b.score-a.score||a.no-b.no).slice(0,3);
 return {version:VERSION,race:{date:r.date,venue:r.venue,race_no:r.race_no,start:r.start},profiles:Object.fromEntries(p),missing:r.riders.some(x=>x.meta?.absent_fields?.length)||r.source?.missing_fields?.includes('b_s_recent')||false,narratives,tickets,chosen,keymen,front:narratives[0].front,dataSource:r.source?.label||'入力出走表',intelligence:{generated_at:pack.generated_at||null,evidence_count:[...p.values()].reduce((s,x)=>s+x.evidence.length,0),cutoff_policy:'published_at AND collected_at < race start (JST)'},rating:'未校正の仮説スコア（的中確率ではありません）'};
}
const api={VERSION,profiles,build};if(typeof module!=='undefined')module.exports=api;root.RaceBrain=api;
})(typeof globalThis!=='undefined'?globalThis:this);
