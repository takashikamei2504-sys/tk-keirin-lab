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
 let race={date:raw.date,venue:raw.venue,race_no:raw.race_no,start:raw.start,grade:raw.grade||'',class:raw.class||'',lineup:clone(raw.lineup),source:clone(raw.source||{}),riders:raw.riders.map(x=>({no:x.no,name:x.name,score:x.score,style:x.style,s:x.s,b:x.b,wins:x.wins,seconds:x.seconds,thirds:x.thirds,outs:x.outs,meta:clone(x.meta||{}),recent_form:x.recent_form?clone(x.recent_form):null,s_source:x.s_source?clone(x.s_source):null})),race_material:clone(raw.race_material||{})};
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
 race.race_material.comments=(race.race_material.comments||[]).filter(allowed);
 pack.observations=[...pack.observations,...race.race_material.comments];
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
  feature('track',.55,'追走の直接資料なし・中立値');feature('block',.4,'牽制の直接資料なし・中立値');
  feature('position',x.style==='両'?.58:.4,`脚質${x.style}の位置取り暫定値`);
  feature('finish',total>0?Math.min(.95,.25+(x.wins+x.seconds+x.thirds)/total*.6):.45,total>0?`3着内${x.wins+x.seconds+x.thirds}／出走${total}（差し脚の実測ではない）`:'直線資料なし・中立値');
  const traitMap={resist:'initiative',front:'front',kamashi:'sprint',makuri:'sprint',long_makuri:'endurance',track:'track',block:'block',seat:'position',inside:'position',finish:'finish',outer:'finish'};
  for(const [trait,f] of Object.entries(traitMap)){
   const rows=records.filter(e=>e.no===x.no&&e.numeric&&e.trait===trait&&!Object.keys(e.context||{}).length);
   const unique=[...new Map(rows.map(e=>[e.url,e])).values()];if(!unique.length)continue;
   const base=features[x.no][f].value,weight=unique.reduce((a,e)=>a+Math.min(1,e.confidence)*Math.exp(-e.ageDays/270),0);
   features[x.no][f]={value:(base*2+unique.reduce((a,e)=>a+e.value*Math.min(1,e.confidence)*Math.exp(-e.ageDays/270),0))/(2+weight),basis:features[x.no][f].basis+'＋実戦本文観察',sources:unique};
  }
  const syn=Memory.synthesize(records,x.no),mapping={initiative:'initiative',acceleration:'sprint',endurance:'endurance',tracking:'track',support:'block',position:'position',finish:'finish'};
  for(const [axis,f]of Object.entries(mapping)){const a=syn.axes[axis];if(a.sources.length){features[x.no][f].value=Math.max(.05,Math.min(.95,features[x.no][f].value+a.value*.08));features[x.no][f].sources.push(...a.sources);features[x.no][f].basis+='＋本人発言の小幅所見（実行証拠と別）';}}
  for(const f of Object.values(features[x.no]))sources.push(...f.sources);
  if(bRate===null)missing.push('B／総出走');if(!measured('s'))missing.push('S');if(!sources.length)missing.push('戦術の本文根拠');
  features[x.no].missing=missing;
 }
 return {race,features,records,replay_pack:pack,as_of:new Date(at).toISOString(),cutoff:new Date(cutoff).toISOString(),uncertainty:['速度・車間・実測消耗は未取得。位置と負担は戦術仮説上の状態。','バンク・風の定量補正は未実装。',...race.riders.flatMap(x=>features[x.no].missing.length?[`${x.no}番：${features[x.no].missing.join('・')}未取得`]:[])]};
}
const api={prepare};if(typeof module!=='undefined')module.exports=api;root.LineInput=api;
})(typeof globalThis!=='undefined'?globalThis:this);
