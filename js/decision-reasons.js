/* Reasons used by the branch weights themselves, with facts separated from inference. */
(function(root){'use strict';
const Memory=typeof module!=='undefined'?require('./brain-memory.js'):root.BrainMemory;
const Context=typeof module!=='undefined'?require('./rider-context.js'):root.RiderContext;
const norm=s=>String(s||'').replace(/[\s\u3000]/g,'');
const TRAITS={S:['front'],'red-attack':['resist','kamashi'],'red-response':['resist','withdraw'],'home-attack':['makuri','long_makuri'],'back-attack':['makuri'],follow:['track'],'back-follow':['track'],'back-seat':['seat'],'corner-attack':['makuri'],defense:['block','vertical','finish'],inside:['inside','finish'],finish:['finish']};
function plans(text){
 const s=norm(text);if(!Context.validIntention(s))return [];
 const result=[];
 if(/先行|突っ張|積極/.test(s))result.push('lead');
 if(/カマシ|かまし/.test(s))result.push('kamashi');
 if(/捲|まく/.test(s))result.push('makuri');
 if(/番手.*(?:捲|まく|発進)|自分で(?:出|踏)/.test(s))result.push('vertical');
 if(/ブロック|援護|仕事を/.test(s))result.push('block');
 return result;
}
function build(r,records,context){
 const by=new Map(r.riders.map(x=>[x.no,x]));
 const notes=new Map(r.riders.map(x=>[x.no,records.filter(m=>m.no===x.no&&m.kind==='race_intention'&&m.race_id===Memory.raceKey(r)).sort((a,b)=>Date.parse(b.collected_at)-Date.parse(a.collected_at))[0]]));
 const source=e=>e?{url:e.url||e.source_url,published_at:e.published_at||e.source_updated_at,collected_at:e.collected_at,excerpt:e.excerpt||e.declaration||null}:null;
 const who=n=>`${n}番${by.get(n)?.name||''}`;
 function label(key,c){
  if(key.endsWith('-front-response'))return c.key==='resist'?'仕掛けに合わせて踏み直す':'ペースを保って受ける';
  if(key.endsWith('-individual-follow')&&c.actor)return c.actor+'番の追走離れ';
  if(key.endsWith('-line-response'))return c.actor?c.actor+'番が攻防を利用して位置を上げる':'他ラインは反応を見て脚を残す';
  if(key.endsWith('-outside-resolution'))return c.key==='retreat'?'外並走を解消して立て直す':c.key==='continue'?'外の仕掛けを継続する':'外並走なし';
  if(key==='inside-opening')return c.key==='opens'?'内の進路が開く':'内の進路は締まったまま';
  const names={S:'S取り','red-attack':'赤板の仕掛け','red-response':'前受けの応答','red-result':'主導権の攻防','home-attack':'ホームの仕掛け','home-result':'ホームの攻防','back-attack':'バックの反撃','back-result':'バックの攻防','back-follow':'バックの追走',follow:'追走','back-seat':'空き番手','corner-attack':'3〜4角の仕掛け',defense:'番手の判断','block-result':'ブロックの成否',inside:'内の進路'};
  const action={unchanged:'前段階を維持する',wait:'仕掛けを待つ',settle:'隊列を保つ',resist:'突っ張る',yield:'出させて引く',pace:'ペースを保つ',front:'前受け側が守る',take:'仕掛け側が前に出る',settled:'隊列が落ち着く',takes:'前団をとらえる',parallel:'外に併走',solo:'単騎',holds:'追走を保つ',breaks:'追走が離れる',none:'新たな動きを置かない',vertical:'縦に踏む',follow:'差しを待つ',block:'ブロックする',stopped:'仕掛けを止める',survives:'仕掛けが残る',free:'ブロックの影響なし'};
  const [no,tactic]=c.key.split(':');
  const chosen=tactic?`${who(Number(no))}が${tactic==='press'?'抑えに上がる':'カマシを打つ'}`:c.key.startsWith('split:')?'中割り':c.key.startsWith('inside:')?'イン突き':action[c.key]||`${who(Number(c.key))}が動く`;
  if(key==='inside'&&c.key!=='none')return c.key.startsWith('split:')?'3番手が中割りを狙う':'後続がインを狙う';
  return (names[key]||'直線の判断')+'：'+chosen;
 }
 function evaluate(key,c,s){
  const no=c.actor||(['red-response','red-result'].includes(key)?s.front:['follow','back-follow'].includes(key)?r.lineup.find(l=>l.includes(s.leader))?.slice(r.lineup.find(l=>l.includes(s.leader)).indexOf(s.leader)+1)[0]:key==='defense'?s.defender:null),x=by.get(no);
  const facts=[],inferences=[],missing=[];let multiplier=1;
  const fact=(label,src=null,kind='measurement')=>facts.push({no,kind,label,source:source(src)});
  const infer=(label,factor=1)=>{inferences.push(label);multiplier*=factor;};
  if(!x){
   if(['red-attack','home-attack','back-attack','corner-attack'].includes(key)){
    const declared=r.riders.filter(y=>y.no!==(key==='red-attack'?s.front:s.leader)&&y.style!=='追'&&r.lineup.some(l=>l[0]===y.no)).some(y=>notes.get(y.no)?.declaration_complete!==false&&plans(notes.get(y.no)?.declaration).includes(key==='red-attack'?'lead':'makuri'));
    infer(declared?'別線に早い仕掛けの意思があるため、全員が待つ筋は少し軽く見る':'ここでは新たな仕掛けを置かず、前段階の隊列を維持する筋',declared?.8:1);
    if((s.energy[s.leader]||0)>=.22)infer('先行側が脚を使っており、後続が待たずに動く余地も残る',.9);
   }
   return {label:label(key,c),multiplier,facts,inferences,missing,basis:inferences.join('。')||'前段階の位置・仕掛けの成否を引き継ぐ仮説'};
  }
  const note=notes.get(no),declaration=note?.declaration||'',tags=note?.declaration_complete===false?[]:plans(declaration),form=x.recent_form,st=form?.stats;
  if(note&&declaration)fact(`${who(no)}の今回コメント「${declaration}${note.declaration_complete===false?'…（発言末尾未収録）':''}」`,note,'race_intention');
  if(['red-attack','red-response','home-attack','back-attack','corner-attack'].includes(key)){
   fact(`${who(no)}は脚質${x.style||'未取得'}、競走得点${x.score.toFixed(2)}`,null,'registration');
   if(st&&Number.isInteger(st.total)&&st.total>0&&Number.isInteger(st.b)&&st.b>=0){
    fact(`${who(no)}の近況は${st.total}走でB${st.b}回`,form);
    if(['red-attack','red-response'].includes(key)&&['resist','press'].includes(c.key==='resist'?c.key:c.key.split(':')[1])){
     if(st.total>=10&&st.b/st.total>=.35)infer('近況のB比率から、早めに主導権を取りに行く筋を少し重く見る',1.15);
     else if(st.total>=10&&st.b/st.total<=.12)infer('近況のBが少なく、長い先行の断定は弱める',.88);
    }
   }else missing.push(`${who(no)}の発走前に利用可能な近況B資料は未取得`);
  }
  if(key==='S'){
   if(Number.isFinite(x.s)&&!x.meta?.absent_fields?.includes('s'))fact(`${who(no)}のSは${x.s}回${x.s_source?'（'+x.s_source.period+'）':'（入力値・出典未確認）'}`,x.s_source,'S');
   else missing.push(`${who(no)}のS実測は未取得`);
   infer(r.lineup.find(l=>l.includes(no))?.[0]===no?'S取りと前受けを同じ選手が担う筋':'Sを取り、ラインの先頭を迎え入れる筋');
  }
  if(key==='red-attack'){
   const tactic=c.key.split(':')[1];
   if(tags.includes('lead')&&tactic==='press')infer('今回の先行意思を、赤板から前へ出る選択に反映する',1.5);
   if(tags.includes('kamashi')&&tactic==='kamashi')infer('今回のカマシ意思を、一気に叩く選択に反映する',1.5);
   if(tags.includes('makuri')&&tactic==='press'&&!tags.includes('lead'))infer('捲りの意思があるため、赤板から抑える筋は少し下げる',.8);
   const line=context.lines.find(l=>l.leader===no);
   for(const label of (line?.facts||[]).filter(f=>!f.startsWith('今回の本人')).slice(0,2))fact(label,line.sources?.find(e=>e.peer&&label.includes(e.peer)),'line_relationship');
   if(line?.motivation>0)infer(line.inference);
   infer(tactic==='kamashi'?'後方から勢いを付ける代わりに踏み出しの負担が増える':'抑えで位置を上げ、後続を連れ出す筋');
  }
  if(key==='red-response'){
   if(tags.includes('lead'))infer(c.key==='resist'?'先行意思を尊重して突っ張る筋を重く見る':'先行意思があるため、簡単には出させない筋も残す',c.key==='resist'?1.5:.85);
   if(tags.includes('makuri')&&!tags.includes('lead'))infer(c.key==='yield'?'捲りの意思と、引いて脚を残す判断がつながる':'捲りの意思があり、前受けからの踏み合いは控えめに見る',c.key==='yield'?1.25:.85);
   const attacker=by.get(s.attacker);
   if(attacker){fact(`仕掛ける${who(attacker.no)}は競走得点${attacker.score.toFixed(2)}`,null,'comparison');infer(c.key==='resist'?'出させない代わりに、ホーム以降へ消耗を持ち越す':'位置を失う代わりに、後の捲りへ脚を残す');}
  }
  if(['home-attack','back-attack','corner-attack'].includes(key)){
   if(tags.includes('makuri'))infer('本人の捲り意思を、ここでの仕掛けに反映する',1.4);
   const fatigue=s.energy[s.leader]||0;
   if(fatigue>=.22)infer('前の攻防で先行側が脚を使っており、仕掛け時と見る',1.2);
   else infer('先行側の消耗が小さい筋なので、すぐに捲り切れるとは置かない');
   if((s.energy[no]||0)>=.2)infer('自身も既に仕掛けで脚を使っており、再加速は控えめに見る',.82);
   infer(`この時点では${s.order.indexOf(no)+1}番手。${key==='home-attack'?'早めに距離を踏む負担を負って位置を上げる':'残る距離と外を回る負担が成立条件になる'}`);
  }
  if(['follow','back-follow'].includes(key))infer(s.homeRider||s.tactic==='kamashi'?'急な加速への追走が分岐。Bや得点だけで追走成功とは断定しない':'前の加速に続けるかを検討。追走力の直接測定ではない');
  if(key==='defense'){
   if(tags.includes(c.key))infer('今回の本人意思を、横の仕事か縦の踏み出しかの判断に反映する',1.5);
   if(c.key==='block')infer(s.seat?'別線から入った番手であり、元のラインと同じ援護意欲とは置かない':'元のラインの番手として外の仕掛けに抵抗する筋',s.seat ? .7 : 1);
   if(c.key==='vertical')infer((s.energy[s.leader]||0)>=.22?'先行が脚を使った流れを見て、横へ振るより自分で縦へ踏む':'横の仕事より自身の伸びを優先する筋',(s.energy[s.leader]||0)>=.22?1.2:1);
   if(c.key==='follow')infer('差しのタイミングを待つ代わりに、外の進出を止める動きは取らない');
  }
  if(key==='inside')infer('直前のブロックで内が空いた仮説が前提。コースが開かなければこの筋は成立しない');
  const usedTraits=key.endsWith('-individual-follow')?['track']:key==='red-attack'?[c.key.endsWith(':press')?'resist':'kamashi']:key==='red-response'?[c.key==='resist'?'resist':'withdraw']:key==='defense'?(c.key==='block'?['block']:c.key==='vertical'?['vertical','finish']:[]):TRAITS[key]||[];
  const matchedContext=Memory.context(r,no,s);
  const evidence=usedTraits.flatMap(k=>Memory.review(.5,records,no,k,matchedContext).sources).sort((a,b)=>b.confidence-a.confidence||a.ageDays-b.ageDays)[0];
  const general=usedTraits.map(k=>Memory.review(.5,records,no,k,matchedContext).qualitative).filter(q=>q.source_count);
  const generalSources=[...new Map(general.flatMap(q=>q.contributions.flatMap(c=>c.sources)).map(m=>[m.url+'|'+m.excerpt,m])).values()];
  for(const row of generalSources.slice(0,2))fact(`${who(no)}の総合材料となる発言「${row.excerpt}」`,row,'qualitative_statement');
  if(general.length)inferences.push(`${who(no)}は、${general[0].summary}。局面に合う範囲で小幅反映する`);
  if(evidence)fact(`${who(no)}の本文観察「${evidence.excerpt}」`,evidence,'observed_action');
  else if(usedTraits.length)missing.push(`${who(no)}のこの動作を裏付ける本文観察は未取得`);
  return {label:label(key,c),no,used_traits:usedTraits,intent_tags:tags,multiplier:Math.max(.5,Math.min(2,multiplier)),facts,inferences,missing,basis:[...facts.map(f=>f.label),...inferences].join('。')||'現時点の位置と消耗からの暫定判断'};
 }
 function scene(decisions){
  const facts=[],inferences=[],missing=[],seen=new Set();
  for(const d of decisions)for(const [key,out] of [['facts',facts],['inferences',inferences],['missing',missing]])for(const v of d.reasoning?.[key]||[]){const id=key+'|'+(typeof v==='string'?v:v.label);if(!seen.has(id)){seen.add(id);out.push(v);}}
  return {facts,inferences,missing,decisions};
 }
 function finish(s,trio){
  const chosen=evaluate('finish',{key:String(trio[0]),actor:trio[0]},{...s,phase:'最後の直線'});
  chosen.inferences.push(...trio.map(n=>`${who(n)}は最終コーナーの${s.order.indexOf(n)+1}番手から直線へ。${(s.energy[n]||0)>=.22?'ここまで踏んだ負担も残る筋':'ここまでの踏む負担が比較的小さい筋'}として比べる`));
  return {facts:chosen.facts,inferences:chosen.inferences,missing:chosen.missing,decisions:[]};
 }
 return {evaluate,scene,finish};
}
const api={build,plans};if(typeof module!=='undefined')module.exports=api;root.DecisionReasons=api;
})(typeof globalThis!=='undefined'?globalThis:this);
