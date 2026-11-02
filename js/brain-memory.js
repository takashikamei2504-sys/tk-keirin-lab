/* Automatic, pre-race evidence memory. Comments never become executed actions. */
(function(root){'use strict';
const traits=new Set(['front','resist','withdraw','kamashi','makuri','track','seat','recover','finish','outer','block','vertical','inside','long_makuri']);
const key=s=>String(s||'').replace(/[\s\u3000]/g,'');
const raceKey=r=>`${r.date}:${r.venue}:${r.race_no}`;
const cutoffOf=r=>Date.parse(`${r.date}T${r.start}:00+09:00`);
function before(row,cutoff){
 const pub=Date.parse(row.published_at),col=Date.parse(row.collected_at);
 return row.body_verified===true&&/^https:\/\//.test(row.url||'')&&Number.isFinite(cutoff)&&
  Number.isFinite(pub)&&Number.isFinite(col)&&pub<=col&&pub<cutoff&&col<cutoff;
}
function build(r,pack={}){
 const cutoff=cutoffOf(r),byName=new Map(r.riders.map(x=>[key(x.name),x]));
 const records=[],seen=new Set();
 for(const [kind,rows] of [['habitual_observation',pack.evidence||[]],['interview_comment',pack.observations||[]],['rider_knowledge',pack.knowledge||[]]])for(const row of rows.slice().sort((a,b)=>(b.confidence||0)-(a.confidence||0)||String(a.collected_at).localeCompare(String(b.collected_at))||(a.value??0)-(b.value??0)||String(a.id||a.excerpt||'').localeCompare(String(b.id||b.excerpt||'')))){
  const rider=byName.get(key(row.rider));
  if(!rider||!before(row,cutoff)||(row.rider_id&&String(row.rider_id).padStart(6,'0')!==String(rider.meta?.rider_id||rider.id||rider.rider_id).padStart(6,'0')))continue;
  if(kind==='habitual_observation'&&(!traits.has(row.trait)||!Number.isFinite(row.value)||row.value<0||row.value>1||!Number.isFinite(row.confidence)||row.confidence<=0))continue;
  const id=(kind!=='habitual_observation'?[rider.no,row.url,row.kind||kind,row.race_id||'',row.declaration||'',row.excerpt]:[rider.no,row.url,row.trait,JSON.stringify(Object.entries(row.context||{}).sort())]).join('|');if(seen.has(id))continue;seen.add(id);
  // Older generic comments stay readable but cannot affect numeric traits.
  let type=kind;
  if(kind==='interview_comment'&&row.kind==='race_intention'&&row.race_id===raceKey(r))type='race_intention';
  if(kind==='interview_comment'&&row.kind==='current_form'&&Date.parse(row.valid_until)>=cutoff)type='current_form';
  records.push({...row,subject_ambiguous:r.riders.some(x=>x.no!==rider.no&&key(row.excerpt).includes(key(x.name))),no:rider.no,kind:type,scope:type==='race_intention'?raceKey(r):type==='current_form'?'period':'rider',
   numeric:kind==='habitual_observation',ageDays:Math.max(0,(cutoff-Date.parse(row.published_at))/86400000)});
 }
 return records.sort((a,b)=>a.no-b.no||a.url.localeCompare(b.url)||String(a.trait||a.kind).localeCompare(String(b.trait||b.kind))||JSON.stringify(a.context||{}).localeCompare(JSON.stringify(b.context||{})));
}
// Synthesis of attributed statements: small contextual adjustments, never measured ability.
const synthesisCache=new WeakMap();
const AXES={readiness:'調整・回復',initiative:'主導権への姿勢',acceleration:'加速・仕掛け',tracking:'追走',finish:'直線の脚色',endurance:'長く踏む力',support:'援護',position:'位置取り'};
function synthesize(records,no){
 let cache=synthesisCache.get(records);if(!cache){cache=new Map();synthesisCache.set(records,cache);}if(cache.has(no))return cache.get(no);
 const sourceRows=records.filter(m=>m.no===no&&!m.numeric&&['rider_knowledge','interview_comment','current_form'].includes(m.kind));
 const rows=[],seen=new Set();
 for(const m of sourceRows.slice().sort((a,b)=>a.url.localeCompare(b.url)||String(a.excerpt).localeCompare(String(b.excerpt)))){
  const text=key(m.excerpt),id=m.url+'|'+text;if(seen.has(id)||!text)continue;seen.add(id);
  const signals={};
  // The speaker may describe an opponent, an old plan, a hypothetical or incomplete quote.
  const other=m.subject_ambiguous||/[一-龥々]{2,}(?:君|さん|選手)(?:が|は|も)|(?:彼|相手|後輩|先輩)(?:が|は)/.test(text);
  const hypothetical=/なら|れば|かもしれ|つもり|したい|してみたい|のでは|というアドバイス/.test(text);
  const historical=/以前|当時|昔は|去年|昨年|数年前/.test(text);
  const usable=!other&&!hypothetical&&!historical&&!m.truncated&&m.ageDays<=540;
  if(usable){
   if(m.ageDays<=30){
    if(/疲れ.{0,5}(?:残っていない|残らず|抜け|取れ)|(?:状態|調子|体調).{0,5}(?:良い|いい|上向|良くなった|よくなった)|練習.{0,8}(?:順調|十分|できてます|できています|できました)/.test(text)&&!/良くない|よくない|良くなかった|よくなかった|十分で(?:は)?ない|不安/.test(text))signals.readiness=.65;
    if(/疲れ.{0,5}残|疲労.{0,5}残|(?:状態|調子).{0,8}(?:不安|悪い|悪く|良くない|よくない)|体調.{0,5}崩|練習.{0,12}(?:できていない|できてない|できなかった|できません)|腰痛|不調/.test(text)&&!/疲れ.{0,5}(?:残っていない|残らず)|不安(?:は|が)?ない|腰痛.{0,4}(?:治った|なくな)/.test(text))signals.readiness=-.8;
    if(/(?:追走|踏み出し).{0,6}(?:できな|不安|厳し)|(?:千切れ|ちぎれ|離れ)(?:た|て)/.test(text))signals.tracking=-.7;
    if(/追走.{0,5}(?:できた|できました|余裕)|離れず|食らいついた/.test(text))signals.tracking=.65;
    if(/直線.{0,5}(?:伸びた|伸びました|余裕)|差し切れた|差し切りました/.test(text))signals.finish=.65;
    if(/直線.{0,5}(?:伸びな|脚がない)|差せなかった/.test(text))signals.finish=-.7;
   }
   // Only explicit habitual self descriptions; a one-race intention is handled separately.
   if(!/昨日|今日|今回は|前回|初日/.test(text)){
    if(/先行(?:が持ち味|が得意|を基本|基本)|突っ張りが(?:得意|持ち味)/.test(text))signals.initiative=.65;
    if(/(?:カマシ|かまし|ダッシュ).{0,3}(?:が得意|が持ち味|には自信)/.test(text))signals.acceleration=.65;
    if(/(?:追走|踏み出し).{0,3}(?:が苦手|に不安)/.test(text))signals.tracking=-.65;
    if(/(?:追走|踏み出し).{0,3}(?:が得意|には自信)/.test(text))signals.tracking=.65;
    if(/(?:直線|差し脚).{0,3}(?:が得意|が持ち味|には自信)/.test(text))signals.finish=.65;
    if(/(?:地脚|持久力|長く踏む).{0,3}(?:が得意|が持ち味|には自信)/.test(text))signals.endurance=.65;
    if(/(?:位置取り|飛び付き).{0,3}(?:が得意|が持ち味)/.test(text))signals.position=.65;
    if(/(?:ブロック|援護).{0,3}(?:が得意|が持ち味)/.test(text))signals.support=.65;
   }
  }
  rows.push({...m,signals,interpretation:Object.keys(signals).length?'発言からの暫定的な総合所見':'話題・背景として参照。向きや効果を確定できず数値補正なし'});
 }
 const axes=Object.fromEntries(Object.keys(AXES).map(axis=>[axis,aggregate(rows,axis)]));
 const background=[...new Set(rows.flatMap(m=>m.topics||[]))];
 const messages=[];
 if(axes.readiness.value<0)messages.push('疲労・調整への不安を含む発言があり、仕掛け直しや追走、直線の余力を少し慎重に見る');
 if(axes.readiness.value>0)messages.push('状態や練習について前向きな発言があり、仕掛けと終盤の余力に小さな後押しを置く');
 for(const axis of Object.keys(AXES).filter(k=>k!=='readiness'))if(axes[axis].value)messages.push(AXES[axis]+(axes[axis].value>0?'を支える本人・本文の発言を候補比較に加える':'への不安を候補比較に加える'));
 const result={schema:'tk-rider-synthesis/v1',no,axes,rows,background,summary:messages.join('。')||(rows.length?'公開発言を総合資料として参照。走りへの効果を確定できる材料は不足している':'利用可能な総合資料は未取得'),source_count:new Set(rows.map(m=>m.url)).size,scope:'発走前の公開発言による未校正の総合所見。実測能力・確定した行動ではない'};
 cache.set(no,result);return result;
}
function aggregate(rows,axis,excluded=[]){
 const byUrl=new Map();for(const row of rows){if(!Number.isFinite(row.signals[axis])||excluded.includes(row.url))continue;const list=byUrl.get(row.url)||[];list.push(row);byUrl.set(row.url,list);}
 let sum=0,mass=1;const sources=[];
 for(const list of byUrl.values()){
  const age=Math.max(...list.map(m=>m.ageDays)),weight=.6*Math.exp(-age/(axis==='readiness'?10:180));
  const values=[...new Set(list.map(m=>m.signals[axis]))];sum+=values.reduce((a,b)=>a+b,0)/values.length*weight;mass+=weight;sources.push(...list);
 }
 return {value:sum/mass,sources};
}
function qualitative(records,no,trait,excluded=[]){
 const profile=synthesize(records,no),mapping={front:{initiative:.10},resist:{initiative:.10,endurance:.08,readiness:.04},withdraw:{initiative:-.04},kamashi:{acceleration:.10,readiness:.08},makuri:{acceleration:.06,endurance:.04,readiness:.08},long_makuri:{endurance:.10,readiness:.08},track:{tracking:.12,readiness:.06},seat:{position:.10,readiness:.03},recover:{readiness:.08,endurance:.05},finish:{finish:.12,readiness:.08},outer:{finish:.08,readiness:.08},inside:{position:.08,finish:.04},block:{support:.10,readiness:.03},vertical:{finish:.07,readiness:.06}};
 const contributions=[];let delta=0;
 for(const [axis,scale] of Object.entries(mapping[trait]||{})){
  const a=excluded.length?aggregate(profile.rows,axis,excluded):profile.axes[axis],sources=a.sources;if(!sources.length)continue;
  // If this article already provided the direct action measurement, avoid a second vote.
  const value=a.value,change=value*scale;delta+=change;contributions.push({axis,label:AXES[axis],value,delta:change,sources});
 }
 return {delta:Math.max(-.08,Math.min(.08,delta)),contributions,summary:profile.summary,source_count:new Set(contributions.flatMap(c=>c.sources.map(m=>m.url))).size,scope:profile.scope};
}

const PHASES=['並び確認・S取り','赤板周回～打鐘','最終ホーム','最終バック','最終3～4コーナー','最後の直線'];
function context(r,no,s={}){
 const line=r.lineup.find(l=>l.includes(no)),stage=s.stage??0;
 const head=line?.[0],attack=stage>=2&&(head===s.homeRider||head===s.backRider)?'makuri':head===s.attacker&&s.tactic==='kamashi'?'kamashi':head===s.attacker&&s.tactic==='press'?'press':'unknown';
 return {phase:s.phase||PHASES[stage],role:line?.[0]===no?'leader':'follower',attack_type:attack,connection:s.connected?.[no]===false?'detached':s.connected?.[no]===true?'connected':'unknown'};
}
function matching(records,no,trait,ctx={}){
 return records.filter(m=>m.no===no&&m.numeric&&m.trait===trait&&(!m.context||Object.entries(m.context).every(([k,v])=>ctx[k]===v)));
}
function review(prior,records,no,trait,ctx={}){
 // One article has at most one vote per situation, even if multiple rows match.
 const articles=new Map();
 for(const m of matching(records,no,trait,ctx)){
  const old=articles.get(m.url),specific=Object.keys(m.context||{}).length;
  if(!old||specific>Object.keys(old.context||{}).length||specific===Object.keys(old.context||{}).length&&(m.confidence>old.confidence||m.confidence===old.confidence&&m.id<old.id))articles.set(m.url,m);
 }
 const sources=[...articles.values()].sort((a,b)=>a.url.localeCompare(b.url));let mass=1.8,sum=prior*mass;
 for(const m of sources){const w=Math.min(1,m.confidence)*Math.exp(-m.ageDays/270);sum+=w*m.value;mass+=w;}
 const general=qualitative(records,no,trait,sources.map(m=>m.url));
 return {trait,prior,value:Math.max(.08,Math.min(.92,sum/mass+general.delta)),qualitative:general,context:{...ctx},source_count:sources.length,sources,scope:sources.length>1?'複数本文の条件付き傾向':sources.length?'一記事の観察による小幅補正':'本文根拠なし・脚質等の暫定値'};
}
function trait(prior,records,no,name,ctx={}){return review(prior,records,no,name,ctx).value;}
const api={build,trait,review,matching,context,raceKey,cutoffOf,synthesize,qualitative};if(typeof module!=='undefined')module.exports=api;root.BrainMemory=api;
})(typeof globalThis!=='undefined'?globalThis:this);
