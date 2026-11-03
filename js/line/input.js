/* LAB LINE input boundary: shared collectors only; never imports a prediction engine. */
(function(root){'use strict';
const Memory=typeof module!=='undefined'?require('../brain-memory.js'):root.BrainMemory;
const Recent=typeof module!=='undefined'?require('../recent-form.js'):root.RecentForm;
const Material=typeof module!=='undefined'?require('../race-material.js'):root.RaceMaterial;
const clone=x=>JSON.parse(JSON.stringify(x));
function prepare(raw,packs={},asOf=Date.now()){
 const cutoff=Date.parse(`${raw?.date}T${raw?.start}:00+09:00`),at=typeof asOf==='number'?asOf:Date.parse(asOf),bound=Math.min(cutoff,at+1);
 if(!Number.isFinite(bound))throw Error('有効な発走時刻と入力時点が必要です');
 const ids=raw.riders?.map(x=>x.no)||[],flat=raw.lineup?.flat()||[];
 if(![7,9].includes(ids.length)||ids.some(n=>!Number.isInteger(n)||n<1||n>9)||new Set(ids).size!==ids.length||flat.length!==ids.length||new Set(flat).size!==ids.length||flat.some(n=>!ids.includes(n))||raw.lineup.some(l=>!l.length)||raw.riders.some(x=>!Number.isFinite(x.score)||!['逃','両','追'].includes(x.style)))throw Error('7車／9車の全選手と重複のないラインが必要です');
 if(raw.source?.mode==='live-public-feed'&&!(Date.parse(raw.source.generated_at)<cutoff&&Date.parse(raw.source.generated_at)<=at))throw Error('発走前の生成日時を確認できない出走表です');
 // Whitelist excludes outcomes, AI marks, odds and provider predictions.
 let race={date:raw.date,venue:raw.venue,race_no:raw.race_no,start:raw.start,grade:raw.grade||'',class:raw.class||'',lineup:clone(raw.lineup),source:Object.fromEntries(['mode','label','url','generated_at','verified','lineup_verified','missing_fields'].filter(k=>raw.source?.[k]!==undefined).map(k=>[k,clone(raw.source[k])])),riders:raw.riders.map(x=>({no:x.no,name:x.name,score:x.score,style:x.style,s:x.s,b:x.b,wins:x.wins,seconds:x.seconds,thirds:x.thirds,outs:x.outs,meta:clone(x.meta||{}),recent_form:x.recent_form?clone(x.recent_form):null,s_source:x.s_source?clone(x.s_source):null})),race_material:clone(raw.race_material||{})};
 // Revalidate previously enriched snapshots against the selected information time.
 for(const x of race.riders){
  if(x.recent_form&&!(Date.parse(x.recent_form.collected_at)<bound&&Date.parse(x.recent_form.source_updated_at)<=Date.parse(x.recent_form.collected_at))){for(const k of ['b','wins','seconds','thirds','outs']){delete x[k];x.meta.absent_fields=[...new Set([...(x.meta.absent_fields||[]),k])];}x.recent_form=null;}
  if(x.s_source&&!(Date.parse(x.s_source.collected_at)<bound)){delete x.s;x.meta.absent_fields=[...new Set([...(x.meta.absent_fields||[]),'s'])];x.s_source=null;}
 }
 if(packs.recent)race=Recent.attach(race,packs.recent,at);
 if(packs.material)race=Material.attach(race,packs.material,at);
 const allowed=row=>Date.parse(row.collected_at)<bound&&Date.parse(row.published_at)<bound;
 const intel=packs.intelligence||{},pack={};
 for(const key of ['evidence','observations','knowledge','relationships'])pack[key]=(intel[key]||[]).filter(allowed);
 race.race_material.comments=(race.race_material.comments||[]).filter(c=>allowed(c)&&c.body_verified===true&&/^https:\/\//.test(c.url||'')&&Date.parse(c.published_at)<=Date.parse(c.collected_at)&&c.race_id===`${race.date}:${race.venue}:${race.race_no}`);
 race.race_material.lineup_conflicts=[];
 for(const c of race.race_material.comments){const actor=race.riders.find(x=>x.name.replace(/\s/g,'')===String(c.rider).replace(/\s/g,''));if(!actor)continue;const line=race.lineup.find(l=>l.includes(actor.no)),at=line.indexOf(actor.no);
  if(c.lineup_intention==='compete'&&(!c.follow_no||!race.lineup.some(l=>l[0]===c.follow_no&&l[1]&&l[1]!==actor.no&&l[0]!==actor.no)))race.race_material.lineup_conflicts.push(actor.name+'の競り先を特定できない');
  else if(c.lineup_intention==='solo'&&line.length!==1)race.race_material.lineup_conflicts.push(actor.name+'の単騎方針と並びが不一致');
  else if(c.lineup_intention!=='compete'&&c.follow_no&&(!line.includes(c.follow_no)||line.indexOf(c.follow_no)>=at||(c.follow_position==='immediate'&&line[at-1]!==c.follow_no)))race.race_material.lineup_conflicts.push(actor.name+'の追走先と並びが不一致');
 }
 pack.observations=[...pack.observations,...race.race_material.comments];
 // Resolve only explicitly identified competition; never invent an unnamed target.
 const contests=[];
 for(const c of race.race_material.comments){
  if(c.lineup_intention!=='compete')continue;
  const actor=race.riders.find(x=>String(x.name).replace(/\s/g,'')===String(c.rider).replace(/\s/g,'')),target=race.lineup.find(l=>l[0]===c.follow_no);
  if(actor&&target&&target[1]&&actor.no!==target[1]&&actor.no!==target[0])contests.push({challenger:actor.no,leader:target[0],incumbent:target[1],source:c});
 }
 race.contests=contests;
 if(contests.length){const resolved=new Set(contests.map(c=>race.riders.find(x=>x.no===c.challenger).name));race.race_material.lineup_conflicts=(race.race_material.lineup_conflicts||[]).filter(message=>!Array.from(resolved).some(name=>message.startsWith(name+'は競り・直付け')));}
 const shared=packs.conditions?.schema==='tk-line-conditions/v1'?(packs.conditions.snapshots||[]).filter(o=>o.venue===race.venue&&(!o.date||o.date===race.date)&&(!o.race_no||o.race_no===race.race_no)):[];
 const observed=[...(raw.conditions?.observations||[]),...shared].filter(o=>o.verified===true&&/^https:\/\//.test(o.source_url||'')&&Date.parse(o.published_at)<=Date.parse(o.collected_at)&&Date.parse(o.collected_at)<bound&&['bank','wind'].includes(o.kind));
 race.conditions={observations:clone(observed.filter(o=>o.kind!=='wind'||bound-Date.parse(o.collected_at)<=3*3600000))};
 const records=Memory.build(race,pack),features={};
 for(const x of race.riders){
  const measured=k=>Number.isFinite(x[k])&&!x.meta.absent_fields?.includes(k),total=['wins','seconds','thirds','outs'].every(measured)?x.wins+x.seconds+x.thirds+x.outs:null;
  const sources=[],missing=[];
  const feature=(key,value,basis)=>{features[x.no][key]={value,basis,sources:[]};return value;};features[x.no]={};
  const ability=Math.max(.1,Math.min(1,(x.score-70)/60));
  feature('ability',ability,`競走得点${x.score}を比較尺度に変換`);
  const bRate=measured('b')&&total>0?x.b/total:null;
  feature('initiative',bRate===null?(x.style==='逃'?.65:x.style==='両'?.43:.18):Math.min(.95,.2+bRate*.85),bRate===null?`脚質${x.style}の暫定値・B率未取得`:`B${x.b}／出走${total}の縮小的比較`);
  feature('front',measured('s')?Math.min(.95,.25+x.s*.035):.4,measured('s')?`S${x.s}`:'S未取得・中立値');
  feature('sprint',.25+ability*.4+(x.style==='両'?.15:0),`得点・脚質${x.style}の暫定値`);
  feature('endurance',.3+features[x.no].initiative.value*.45,'先行傾向による暫定値');
  feature('withdraw',.7-features[x.no].initiative.value*.45,'先行傾向と位置を下げる選択の暫定値');
  feature('kamashi',features[x.no].sprint.value,'得点・脚質からのカマシ暫定値');feature('makuri',features[x.no].sprint.value,'得点・脚質からの捲り暫定値');feature('long_makuri',features[x.no].endurance.value,'長く踏む傾向からの早めの捲り暫定値');
  feature('recover',.25+ability*.25,'脚力を参照した立て直しの暫定値');feature('inside',x.style==='追'?.5:.4,'脚質を参照した内進路の暫定値');
  feature('track',.55,'追走の直接資料なし・中立値');feature('block',.4,'牽制の直接資料なし・中立値');
  feature('position',x.style==='両'?.58:.4,`脚質${x.style}の位置取り暫定値`);
  feature('finish',total>0?Math.min(.95,.25+(x.wins+x.seconds+x.thirds)/total*.6):.45,total>0?`3着内${x.wins+x.seconds+x.thirds}／出走${total}（差し脚の実測ではない）`:'直線資料なし・中立値');
  const traitMap={withdraw:'withdraw',recover:'recover',resist:'initiative',front:'front',kamashi:'kamashi',makuri:'makuri',long_makuri:'long_makuri',track:'track',block:'block',seat:'position',inside:'inside',finish:'finish',outer:'finish'};
  for(const key of new Set(Object.values(traitMap))){
   const rows=records.filter(e=>e.no===x.no&&e.numeric&&!e.subject_ambiguous&&traitMap[e.trait]===key&&!Object.keys(e.context||{}).length),articles=new Map();
   for(const row of rows){if(!articles.has(row.url))articles.set(row.url,[]);articles.get(row.url).push(row);}if(!articles.size)continue;
   const base=features[x.no][key].value;let sum=base*2,mass=2;
   for(const observations of articles.values()){const confidence=Math.min(1,...observations.map(e=>e.confidence)),age=Math.max(...observations.map(e=>e.ageDays)),weight=confidence*Math.exp(-age/270);sum+=observations.reduce((n,e)=>n+e.value,0)/observations.length*weight;mass+=weight;}
   features[x.no][key]={value:sum/mass,basis:features[x.no][key].basis+'＋実戦本文観察',sources:rows};
  }
  const syn=Memory.synthesize(records,x.no),mapping={initiative:'initiative',acceleration:'sprint',endurance:'endurance',tracking:'track',support:'block',position:'position',finish:'finish'};
  for(const [axis,f]of Object.entries(mapping)){const a=syn.axes[axis];if(a.sources.length){features[x.no][f].value=Math.max(.05,Math.min(.95,features[x.no][f].value+a.value*.08));features[x.no][f].sources.push(...a.sources);features[x.no][f].basis+='＋本人発言の小幅所見（実行証拠と別）';}}
  for(const key of ['kamashi','makuri']){const a=syn.axes.acceleration;if(a.sources.length){features[x.no][key].value+=a.value*.08;features[x.no][key].sources.push(...a.sources);features[x.no][key].basis+='＋加速に関する本人発言の小幅所見';}}
  const readiness=syn.axes.readiness;for(const key of ['sprint','kamashi','makuri','long_makuri','track','finish','recover'])if(readiness.sources.length){features[x.no][key].value=Math.max(.05,Math.min(.95,features[x.no][key].value+readiness.value*.05));features[x.no][key].sources.push(...readiness.sources);features[x.no][key].basis+='＋発走前の調整・回復に関する本人発言の小幅所見';}
  if(x.recent_form){const rf=x.recent_form,source={url:rf.source_url,published_at:rf.source_updated_at,collected_at:rf.collected_at,kind:'official_statistics',excerpt:'公式の直近4か月統計'};for(const key of ['initiative','endurance','finish'])features[x.no][key].sources.push(source);}
  if(x.s_source)features[x.no].front.sources.push({url:x.s_source.url,published_at:x.s_source.collected_at,collected_at:x.s_source.collected_at,kind:'measured_s',excerpt:'同一選手と照合したS回数。利用可能時刻の上限は収集時刻'});
  for(const f of Object.values(features[x.no])){f.kind=f.sources.some(e=>e.numeric)?'body_observation':f.sources.some(e=>['official_statistics','measured_s'].includes(e.kind))?'measurement':f.sources.length?'attributed_statement':'statistical_or_provisional';f.sources=[...new Map(f.sources.map(e=>[e.url+'|'+(e.trait||e.kind),e])).values()];sources.push(...f.sources);}
  if(bRate===null)missing.push('B／総出走');if(!measured('s'))missing.push('S');if(!sources.some(e=>e.numeric||!['official_statistics','measured_s'].includes(e.kind)))missing.push('戦術の本文根拠');
  features[x.no].missing=missing;
 }
 return {race,features,records,replay_pack:pack,as_of:new Date(at).toISOString(),cutoff:new Date(cutoff).toISOString(),uncertainty:['速度・車間・実測消耗は未取得。位置と負担は戦術仮説上の状態。',...(race.conditions.observations.length?['バンク・風は出典と情報時点を検査した観測だけ参照。補正規則は未校正。']:['発走前に取得したバンク・風の観測は未取得。無風・標準バンクと断定しない。']),...race.riders.flatMap(x=>features[x.no].missing.length?[`${x.no}番：${features[x.no].missing.join('・')}未取得`]:[])]};
}
const api={prepare};if(typeof module!=='undefined')module.exports=api;root.LineInput=api;
})(typeof globalThis!=='undefined'?globalThis:this);
