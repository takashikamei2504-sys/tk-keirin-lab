/* Post-race positioning audit. Only compare frozen pre-race predictions with verified independent observations. */
(function(root){'use strict';
const allowed=new Set(['press','cut','resist','yield','withdraw','position','wait','kamashi','seat','use']);
const finite=t=>Number.isFinite(Date.parse(t));
const unique=arr=>Array.isArray(arr)&&arr.length>0&&new Set(arr).size===arr.length;
function compare(record,observation,now=Date.now()){
 const exclude=reason=>({status:'excluded',reason,compared:0,matched:0,checks:[]});
 if(record?.schema!=='tk-keirin-line-frozen/v1'||!record.out?.main?.scenes||record.out.main.scenes.length!==6)return exclude('固定した発走前のLINE予測がない');
 const o=record.out,cutoff=Date.parse(o.input?.cutoff),inputTime=Date.parse(o.input?.as_of),saved=Date.parse(record.saved_at),generated=Date.parse(o.generated_at);
 if(o.mode!=='pre-race'||!Number.isFinite(cutoff)||!(inputTime<=generated&&generated<=saved&&saved<cutoff))return exclude('発走前の保存時刻が検証できない');
 const race=o.input.race,raceId=[race.date,race.venue,race.race_no].join(':');
 if(record.race_id!==raceId||observation?.race_id!==raceId)return exclude('レース識別子が一致しない');
 if(!observation.verified||!/^https:\/\//.test(observation.source_url||'')||!finite(observation.published_at)||!finite(observation.collected_at))return exclude('観測元・検証フラグ・時刻が不明');
 const publication=Date.parse(observation.published_at),collection=Date.parse(observation.collected_at);
 if(!(cutoff<=publication&&publication<=collection&&collection<=now))return exclude('発走後の実戦記録の公開・取得時刻が不正');
 if(!observation.initial_order&&!observation.redboard_order&&!observation.actor_sequence)return exclude('照合可能な位置取り観測がない');
 const heads=new Set(o.topology.lines.map(l=>l.head));
 const headOf=id=>o.topology.lines.find(l=>l.id===id)?.head;
 const lineOf=no=>o.topology.lines.find(l=>l.head===no)?.id;
 const validOrder=a=>unique(a)&&a.length===heads.size&&a.every(n=>heads.has(n));
 const checks=[];
 const add=(label,actual,predicted)=>checks.push({label,match:JSON.stringify(actual)===JSON.stringify(predicted),observed:actual,predicted});
 if(observation.initial_order){
  if(!validOrder(observation.initial_order))return exclude('初手の観測は全ラインの先頭車番を重複なく含む必要がある');
  const order=o.main.scenes[0].groups.filter(g=>g.lane===0).map(g=>headOf(g.id));
  add('initial_order',observation.initial_order,order);
 }
 if(observation.redboard_order){
  if(!validOrder(observation.redboard_order))return exclude('打鐘時点の観測は全ラインの先頭車番を重複なく含む必要がある');
  const order=o.main.scenes[1].groups.filter(g=>g.lane===0).map(g=>headOf(g.id));
  add('redboard_order',observation.redboard_order,order);
 }
 if(observation.actor_sequence){
  if(!Array.isArray(observation.actor_sequence)||!observation.actor_sequence.every(e=>heads.has(e.actor_no)&&allowed.has(e.action)))return exclude('行動順序はライン先頭車番と登録済み動作で記録する');
  const actual=observation.actor_sequence.map(e=>({line:lineOf(e.actor_no),action:e.action})),predicted=(o.main.scenes[1].positioning_steps||[]).map(e=>({line:e.actor,action:e.action}));
  add('actor_sequence',actual,predicted);
 }
 return {status:'compared',model_id:o.provenance?.model?.model_id,source_url:observation.source_url,compared:checks.length,matched:checks.filter(x=>x.match).length,checks,scope:'着順の結果ではなく、発走前固定仮説と実際の初手・赤板〜打鐘の位置取りを照合。完全一致は行動の因果的妥当性を保証しない'};
}
function summarize(rows){
 const compared=rows.filter(x=>x.status==='compared'),total=compared.reduce((a,x)=>a+x.compared,0),matched=compared.reduce((a,x)=>a+x.matched,0);
 return {frozen_records:rows.length,records_compared:compared.length,checks_compared:total,checks_matched:matched,exact_rate:total?matched/total:null,excluded:rows.filter(x=>x.status==='excluded').length,warning:total?'観測の網羅性・映像判定の誤差・サンプルの偏りに注意':'実戦の位置取り観測がなく、一致率は算出できない'};
}
const api={compare,summarize};if(typeof module!=='undefined')module.exports=api;root.LinePositioningEvaluation=api;
})(typeof globalThis!=='undefined'?globalThis:this);
