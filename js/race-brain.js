/* Independent state-transition engine. No legacy picks, manual profiles or seed personalities. */
(function(root){
'use strict';
const VERSION='independent-causal-v1.4.3-ex-licensed';
const Ex=typeof module!=='undefined'?require('./ex-profile.js'):root.LabExProfile;
const Transitions=typeof module!=='undefined'?require('./tactical-transitions.js'):root.LabTacticalTransitions;
const MODES={lead:'先頭の押し切り',sashi:'番手差し',seat:'番手はまり',recovery:'追走喪失から再自力',outer:'大外強襲',counter:'引いて捲り返し',thirdline:'第三ラインの捲り',switch:'番手の切替',thirdsprint:'3番手の追込み',solo:'単騎の追上げ'};
const clip=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const nameKey=s=>String(s).replace(/[\s\u3000]/g,'');
const TRAITS=['front','resist','withdraw','kamashi','makuri','track','seat','recover','finish','outer'];
function profiles(r,pack={}){
 const cutoff=Date.parse(`${r.date}T${r.start}:00+09:00`);
 return new Map(r.riders.map(x=>{
  const own=x.style!=='追', absent=new Set([...(x.meta?.absent_fields||[]),...(r.source?.missing_fields?.includes('b_s_recent')&&!x.recent_form?['s','b']:[])]);
  const p={front:.4,resist:own?.55:.22,withdraw:.5,kamashi:own?.6:.2,makuri:own?.6:.22,track:.55,seat:.45,recover:own?.55:.3,finish:clip(.45+(x.score-100)*.012,.2,.8),outer:own?.5:.35,evidence:[],basis:'脚質・得点による暫定値'};
  p.measurements=[];
  if(x.recent_form){const st=x.recent_form.stats,weight=st.total/(st.total+12);
   if(st.total>0){
    p.finish=clip(p.finish+.12*weight*(st.top3_rate/100-.5),.08,.92);
    if(own){const rate=clip(st.b/st.total);p.resist=clip(p.resist+.28*weight*(rate-.35),.08,.92);p.kamashi=clip(p.kamashi+.2*weight*(rate-.35),.08,.92);}
    p.measurements.push(`直近4ヶ月${st.total}走・B${st.b}回（出走比${(100*st.b/st.total).toFixed(1)}%）・3連対率${st.top3_rate.toFixed(1)}%。少数出走は補正を弱める`);
   }
   p.form_basis='出走比Bで主導権・カマシ、3連対率で直線評価を小幅補正（未校正）。追走力や前受けの実測とは扱わない';
  }
  if(!absent.has('s')&&Number.isFinite(x.s))p.front=clip(.3+x.s*.045,.2,.85);
  if(!x.recent_form&&!absent.has('b')&&Number.isFinite(x.b)&&own){p.resist=clip(.4+x.b*.025,.3,.85);p.kamashi=clip(.5+x.b*.015,.35,.85);}
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
  if(Ex)Ex.attach(p,x,r,pack.exPack,pack.exAsOf??Date.now());
  return [x.no,p];
 }));
}
function build(r,pack={},forced=null){
 const ids=r.riders.map(x=>x.no),valid=new Set(ids);
 if(![7,9].includes(ids.length)||valid.size!==ids.length||r.lineup.flat().length!==ids.length||new Set(r.lineup.flat()).size!==ids.length||r.lineup.some(l=>!l.length)||r.lineup.flat().some(n=>!valid.has(n)))throw Error('7車・9車の全選手を並びに一度ずつ指定してください');
 const p=profiles(r,pack),physical=pack.transitionMode==='physical_v2'&&!!Transitions,by=new Map(r.riders.map(x=>[x.no,x])),leaders=r.lineup.map(l=>l[0]),lineOf=new Map();
 r.lineup.forEach(l=>l.forEach(n=>lineOf.set(n,l)));
 const ability=n=>{const x=by.get(n),form=x.recent_form?.stats;return clip(.55+(x.score-100)*.025+(form?.total>0?.12*(form.top3_rate/100-.5):0),.2,1.25);};
 const move=(order,ns,at=0)=>{const rest=order.filter(n=>!ns.includes(n));rest.splice(at,0,...ns);return rest;};
 const narratives=[];
 const choices=(no,key,options)=>forced&&forced.no===no&&forced.key===key?options.filter(x=>x[0]===forced.value).map(x=>[x[0],1]):options;
 const reason=(no,traits,context)=>{
  const pr=p.get(no),e=pr.evidence.filter(x=>traits.includes(x.trait));
  return {no,name:by.get(no).name,context,traits:traits.map(k=>({trait:k,value:pr[k]})),basis:e.length?`公開記事本文${new Set(e.map(x=>x.url)).size}件と脚質・得点を統合`:pr.basis,measurements:pr.measurements,article_sources:[...new Set(e.map(x=>x.url))],limitations:'判断傾向は未校正の仮説。Bや着順だけで性格・追走力を断定しない'};
 };
 const snapshot=(phase,order,energy,action)=>({phase,order:[...order],energy:{...energy},action});
 for(const front of leaders){
  const fl=lineOf.get(front),others=r.lineup.filter(l=>l!==fl).sort((a,b)=>p.get(b[0]).front-p.get(a[0]).front||a[0]-b[0]);
  const initial=[...fl,...others.flat()],fw=.1+p.get(front).front;
  for(const attacker of leaders.filter(n=>n!==front)){
   const al=lineOf.get(attacker),distance=initial.indexOf(attacker)/ids.length;
   for(const [stand,sw] of choices(front,'stand',[['resist',p.get(front).resist],['yield',p.get(front).withdraw]])){
    for(const [tactic,tw] of choices(attacker,'tactic',[['kamashi',p.get(attacker).kamashi],['makuri',p.get(attacker).makuri]])){
     const takes=clip(.5+.3*(ability(attacker)-ability(front))+.2*p.get(attacker)[tactic]-(stand==='resist'?.22:0)-.08*distance+
       (tactic==='kamashi'?(p.get(attacker).ex_kamashi_delta||0):0)-
       (stand==='resist'?(p.get(front).ex_tsuppari_delta||0):0),.12,.88);
     for(const [outcome,ow] of [['attacker-takes',takes],['front-holds',1-takes]]){
      const controller=outcome==='attacker-takes'?attacker:front,cl=lineOf.get(controller),follower=cl[1],third=cl[2];
      let order=outcome==='attacker-takes'?move(initial,al):[...initial];
      const energy=Object.fromEntries(ids.map(n=>[n,0]));
      energy[front]+=stand==='resist'?.34:.08;energy[attacker]+=(tactic==='kamashi'?.3:.2)+distance*.12;
      if(outcome==='front-holds')energy[attacker]+=.16;
      const base=[snapshot('周回',initial,Object.fromEntries(ids.map(n=>[n,0])),`${front}番が前受け。${attacker}番は${initial.indexOf(attacker)+1}番手から上昇`),snapshot('打鐘',stand==='yield'?move(initial,al):initial,energy,`${front}番は${stand==='resist'?'突っ張り':'引き'}を選択。${attacker}番は${tactic==='kamashi'?'カマシ':'脚をためて捲り'}を選択`)];
      // Acceleration stress depends on the actual current leader, speed and follower response.
      const acceleration=controller===attacker?(tactic==='kamashi'?.22:.1):.07;
      const keep=follower?(physical?Transitions.followerOutcome({
       leader:p.get(controller),follower:p.get(follower),
       leaderAbility:ability(controller),followerAbility:ability(follower),
       acceleration,resist:stand==='resist'}).keep:
       clip(.48+.42*p.get(follower).track-acceleration-(stand==='resist'?.08:0)+.08*(ability(follower)-ability(controller))-
       (p.get(controller).ex_chigiri_delta||0)-(p.get(follower).ex_chigirarare_delta||0),.18,.9)):1;
      const gaps=follower?choices(follower,'gap',[['holds',keep],['breaks',1-keep]]):[['solo',1]];
      for(const [gap,gw] of gaps){
       const routes=physical?Transitions.gapBranches({
        order,lineup:r.lineup,controller,gap,profile:p,tactic,
        controllerIsAttacker:controller===attacker}):[null];
       for(const route of routes){
       let home=route?route.order.slice():[...order],en={...energy},seat=route?.seat||null;
       if(gap==='breaks'){
        if(route){en[follower]+=.25;}
        else {
         const ci=home.indexOf(controller),eligible=home.filter(n=>!cl.includes(n));
         seat=eligible.sort((a,b)=>Math.abs(home.indexOf(a)-ci)-Math.abs(home.indexOf(b)-ci)||p.get(b).seat-p.get(a).seat)[0];
         home=home.filter(n=>n!==follower);home.push(follower);en[follower]+=.25;
         if(seat)home=move(home,[seat],home.indexOf(controller)+1);
        }
       }
       const homeSnap=snapshot('最終ホーム',home,en,`${controller}番が主導権。${gap==='breaks'?`${follower}番が先頭から離れ、${seat?`${seat}番が番手へ接近する分岐`:'空席への飛びつきは成立条件不足'}`:gap==='holds'?`${follower}番が追走を維持`:'単騎で進出'}`);
       if(physical){
        homeSnap.seat_state=route.seatState;
        homeSnap.wheel_links=route.links?.edges||[];
        homeSnap.line_segments=route.links?.segments||[];
       }
       const weight=fw*(.2+ability(attacker))*sw*tw*ow*gw*(route?.weight??1);
       const emit=(mode,finisher,back,backEnergy,action,factor)=>{
        const rank=n=>ability(n)*.55+p.get(n).finish*.35+.25*(p.get(n).ex_win_residual||0)-(backEnergy[n]||0)*.3-back.indexOf(n)*.025;
         const decisions=[reason(front,['front','resist','withdraw'],`周回${initial.indexOf(front)+1}番手から${stand==='resist'?'突っ張りで主導権を守る':'引いて脚を温存する'}分岐。消耗${Math.round(en[front]*100)}`),reason(attacker,[tactic],`${initial.indexOf(attacker)+1}番手から${tactic==='kamashi'?'カマシ':'捲り'}。${outcome==='attacker-takes'?'主導権奪取':'前受け側が抵抗し不発'}の分岐`)];
         if(follower)decisions.push(reason(follower,['track'],`${controller}番の${controller===attacker&&tactic==='kamashi'?'急加速':'加速'}と踏み合いを受け、追走${gap==='breaks'?'離れ':'維持'}の分岐。B・3連対率は追走力の実測値には使わない`));
         if(mode==='seat')decisions.push(reason(seat,['seat','finish'],`${follower}番の離れで空いた番手を、隊列上で近い${seat}番が利用`));
         if(mode==='recovery')decisions.push(reason(third,['recover','makuri'],`${follower}番の追走離れで接続を失い、後退してから再自力へ切替`));
         if(['counter','thirdline','switch','thirdsprint','solo'].includes(mode))decisions.push(reason(finisher,mode==='switch'?['track','finish']:mode==='thirdsprint'?['finish']:['makuri','finish'],action));
         if(mode==='outer')decisions.push(reason(outer,['outer','finish'],`前団の消耗${Math.round(en[controller]*100)}を見て外へ。外を回す追加消耗20を負担`));
        const seconds=back.filter(n=>n!==finisher).sort((a,b)=>rank(b)-rank(a)||a-b).slice(0,3);
        for(const second of seconds)for(const thirdNo of back.filter(n=>![finisher,second].includes(n))){
         const finish=[finisher,second,thirdNo,...back.filter(n=>![finisher,second,thirdNo].includes(n))];
         const score=weight*factor*Math.exp(2.5*rank(second)+1.8*rank(thirdNo));
         const snapshots=[...base,homeSnap,snapshot('最終バック',back,backEnergy,action),snapshot('直線',finish,backEnergy,`${finisher}番が伸び、${second}番・${thirdNo}番へ。消耗と位置・差し脚から決着候補を生成`)];
         if(snapshots.some(s=>s.order.length!==ids.length||new Set(s.order).size!==ids.length))throw Error('隊列遷移の不整合');
         narratives.push({decisions,mode,front,attacker,stand,tactic,outcome,leader:controller,gap,seat,seat_state:route?.seatState||null,wheel_links:route?.links?.edges||[],first:finisher,second,third:thirdNo,key:[finisher,second,thirdNo].join('-'),trio:[finisher,second,thirdNo],score,rare:['seat','recovery','outer'].includes(mode),snapshots,states:snapshots.map(s=>`${s.phase}：${s.action}【隊列 ${s.order.join('→')}】`),explanation:`${front}番の${stand==='resist'?'抵抗による消耗':'引いて温存'} → ${controller}番が主導権 → ${gap==='breaks'?(seat?'番手接近の成立仮説':'空席・別線の無条件割り込みなし'):'追走隊列を維持'} → ${action}`});
        }
       };
       emit('lead',controller,home,en,`${controller}番が先頭を維持`,.35+ability(controller)*.4-en[controller]*.25);
       if(gap==='holds')emit('sashi',follower,home,en,`${follower}番は番手で脚をため差しを狙う`,.25+p.get(follower).finish*.55);
       if(gap==='breaks'&&seat)emit('seat',seat,home,en,`${seat}番が近接進入から番手奪取を試みる成立仮説`,physical?.15+p.get(seat).finish*.25:.15+p.get(seat).seat*.3+p.get(seat).finish*.25+(p.get(seat).ex_tobitsuki_delta||0)+.25*(p.get(seat).ex_seri_delta||0));
       // The third rider first loses contact, then switches to an independent attack.
       if(!physical&&third&&gap==='breaks'){
        let back=home.filter(n=>n!==third);back.push(third);const re={...en,[third]:(en[third]||0)+.26};
        emit('recovery',third,back,re,`${third}番が${gap==='breaks'?'前の離れで':'踏み直しで'}追走を失い後退。再自力に切り替えて外を捲る`,.06+p.get(third).recover*.25+p.get(third).makuri*.1);
       }
       // Later moves arise from the position created by the earlier contest.
       if(stand==='yield'&&controller===attacker&&by.get(front).style!=='追'){
        const ce={...en,[front]:en[front]+.24};
        emit('counter',front,move(home,[front]),ce,`${front}番は引いて温存した脚で、先行する${controller}番を最終バックから捲り返す`,.09+p.get(front).makuri*.24-en[front]*.08);
       }
       if(stand==='resist')for(const rival of leaders.filter(n=>n!==front&&n!==attacker&&by.get(n).style!=='追')){
        const te={...en,[rival]:en[rival]+.28};
        emit('thirdline',rival,move(home,lineOf.get(rival)),te,`${front}番と${attacker}番の先行争いを見て${rival}番の第三ラインが仕掛ける。外を踏む消耗を負担`,.08+p.get(rival).makuri*.2+en[controller]*.13);
       }
       if(outcome==='front-holds'&&al[1]){
        const sw=al[1],se={...en,[sw]:en[sw]+.16};
        emit('switch',sw,move(home,[sw],Math.min(home.indexOf(controller)+2,ids.length-1)),se,`${attacker}番の仕掛け不発を受け${sw}番が別線の後ろへ切り替える。先頭・番手を奪ったとは扱わず、後方から直線で伸びる`,.05+p.get(sw).track*.12+p.get(sw).finish*.1);
       }
       if(third&&gap==='holds')emit('thirdsprint',third,home,en,`${third}番は追走を保ったまま3番手で脚をため、先頭の消耗を見て直線の追込みを狙う`,.06+p.get(third).finish*.2+en[controller]*.1);
       for(const solo of r.lineup.filter(l=>l.length===1&&l[0]!==controller).map(l=>l[0])){
        const se={...en,[solo]:en[solo]+.18};
        emit('solo',solo,move(home,[solo],Math.min(home.indexOf(controller)+2,ids.length-1)),se,`単騎${solo}番は動いたラインを追い上げて後位へ。位置を取る消耗を負担し、直線勝負に持ち込む`,.05+p.get(solo).track*.1+p.get(solo).finish*.1);
       }
       const outer=home.filter(n=>!cl.includes(n)).sort((a,b)=>p.get(b).outer+ability(b)*.2-p.get(a).outer-ability(a)*.2)[0];
       if(outer){const oe={...en,[outer]:(en[outer]||0)+.2};emit('outer',outer,home,oe,`${outer}番が${stand==='resist'?'踏み合いによる前の消耗':'前団の仕掛け'}を見て大外へ持ち出し強襲`,.08+p.get(outer).outer*.25+en[controller]*.25);}
       }
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
 const chosen=tickets.slice(0,16).map(t=>({...t,selection_reason:'複数の展開分岐を合算した仮説スコア上位',supporting_path:t.paths[0]})),used=new Set(chosen.map(t=>t.key));
 const represented=new Set(chosen.map(t=>t.supporting_path.mode));
 for(const n of narratives){if(chosen.length===20)break;if(represented.has(n.mode)||used.has(n.key))continue;chosen.push({...map.get(n.key),selection_reason:MODES[n.mode]+'の別筋を確保（仮説スコア順）',supporting_path:n});represented.add(n.mode);used.add(n.key);}
 for(const t of tickets){if(chosen.length===20)break;if(!used.has(t.key)){chosen.push({...t,selection_reason:'未採用の候補から仮説スコア順に補完',supporting_path:t.paths[0]});used.add(t.key);}}
 // Aggregate identical tactical contexts, so many finish permutations do not become duplicate stories.
 const groups=new Map();
 for(const n of narratives){const id=[n.mode,n.front,n.attacker,n.stand,n.tactic,n.outcome,n.gap].join(':');if(!groups.has(id))groups.set(id,{id,mode:n.mode,score:0,representative:n,paths:0});const h=groups.get(id);h.score+=n.score;h.paths++;}
 const ranked=[...groups.values()].sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)),hypotheses=ranked.slice(0,3);
 for(const h of ranked){if(hypotheses.length===6)break;if(!hypotheses.some(x=>x.mode===h.mode))hypotheses.push(h);}
 const distribution=ns=>{const m=new Map(),total=ns.reduce((s,n)=>s+n.score,0)||1;for(const n of ns)m.set(n.first,(m.get(n.first)||0)+n.score/total);return m;};
 // Matched contexts: each opposite decision is normalized within identical other decisions.
 // This avoids crediting a keyman merely for appearing in many branches.
 const pivots=[];
 for(const no of ids)for(const [key,label,a,b] of [['stand','突っ張るか／引くか','resist','yield'],['tactic','カマシか／捲りか','kamashi','makuri'],['gap','追走を維持するか／離れるか','holds','breaks']]){
  const role=key==='stand'?'front':key==='tactic'?'attacker':'follower';
  const relevant=narratives.filter(n=>role==='follower'?lineOf.get(n.leader)[1]===no:n[role]===no);
  const groups=new Map();for(const n of relevant){const context=[n.front,n.attacker,...(key==='gap'?[n.outcome]:[]),...['stand','tactic','gap'].filter(k=>k!==key).map(k=>n[k])].join('|');if(!groups.has(context))groups.set(context,[[],[]]);const k=n[key]===a?0:n[key]===b?1:-1;if(k>=0)groups.get(context)[k].push(n);}
  let diff=0,count=0;const da=new Map(),db=new Map();
  for(const [aa,bb] of groups.values()){if(!aa.length||!bb.length)continue;const ad=distribution(aa),bd=distribution(bb);diff+=ids.reduce((s,n)=>s+Math.abs((ad.get(n)||0)-(bd.get(n)||0)),0)/2;for(const n of ids){da.set(n,(da.get(n)||0)+(ad.get(n)||0));db.set(n,(db.get(n)||0)+(bd.get(n)||0));}count++;}
  if(count){
   const winner=d=>[...d].sort((x,y)=>y[1]-x[1])[0][0],wa=winner(da),wb=winner(db);
   const changed=ids.map(n=>({no:n,change:((db.get(n)||0)-(da.get(n)||0))/count})).sort((x,y)=>Math.abs(y.change)-Math.abs(x.change)||x.no-y.no)[0];
   pivots.push({no,name:by.get(no).name,score:diff/count,decisions:[label,`対になる${count}条件を比較：${wa!==wb?`１着候補 ${wa}番 → ${wb}番`:`候補${changed.no}番の仮説内比重が${Math.abs(changed.change*100).toFixed(1)}pt変化（的中確率ではない）`}`],matched_contexts:count});
  }
 }
 const best=new Map();for(const x of pivots)if(!best.has(x.no)||best.get(x.no).score<x.score)best.set(x.no,x);
 const keymen=[...best.values()].sort((a,b)=>b.score-a.score||a.no-b.no).slice(0,3);
 return {version:VERSION,transition_mode:physical?'physical_v2':'legacy',race:{date:r.date,venue:r.venue,race_no:r.race_no,start:r.start},profiles:Object.fromEntries(p),missing:r.riders.some(x=>x.meta?.absent_fields?.length)||r.source?.missing_fields?.includes('b_s_recent')||false,narratives,hypotheses,tickets,chosen,keymen,front:narratives[0].front,dataSource:r.source?.label||'入力出走表',intelligence:{generated_at:pack.generated_at||null,evidence_count:[...p.values()].reduce((s,x)=>s+x.evidence.length,0),cutoff_policy:'published_at AND collected_at < race start (JST)'},rating:'未校正の仮説スコア（的中確率ではありません）'};
}
const api={VERSION,MODES,profiles,build};if(typeof module!=='undefined')module.exports=api;root.RaceBrain=api;
})(typeof globalThis!=='undefined'?globalThis:this);
