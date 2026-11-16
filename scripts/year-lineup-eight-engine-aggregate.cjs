#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),E=require('../js/b-upset/evaluation.cjs');
const base=path.resolve(__dirname,'../reports/year-race-type');
const WAYS=['auto','physical','causal','lab_v5','line','roi_coverage','b_upset_ad','b_upset_expanded'];
const parts=Array.from({length:3},(_,i)=>JSON.parse(fs.readFileSync(path.join(base,'shards/archive-replay-part-'+i+'.json'),'utf8')));
const prepared=JSON.parse(fs.readFileSync(path.join(base,'annual-60-card-input-audit.json'),'utf8'));
if(prepared.schema!=='tk-keirin-2025-26-fullcard-pilot/v1')throw Error('Bad prepared input');
const ids=new Set(),rows=[],failures={};
for(let i=0;i<parts.length;i++){
 const p=parts[i];if(p.scope.part!==i||p.scope.offset!==i*20||p.scope.max!==20||p.scope.source_sample!==60)throw Error('Invalid shard '+i);
 for(const [k,v] of Object.entries(p.failures)){failures[k]=(failures[k]||0)+v.count}
 for(const r of p.rows){if(ids.has(r.race_id))throw Error('Duplicate race ID '+r.race_id);ids.add(r.race_id);rows.push(r)}
}
const eligible=prepared.cards.filter(c=>c.status==='ready');
if(eligible.length!==prepared.prepared_n)throw Error('Mismatched prepared count');
if(eligible.length!==rows.length+Object.values(failures).reduce((a,b)=>a+b,0) && rows.length>eligible.length)throw Error('Impossible row count');
rows.sort((a,b)=>a.date.localeCompare(b.date)||a.race_id.localeCompare(b.race_id));
const complete=rows.filter(r=>WAYS.every(e=>r.predictions[e]));
const metric=(list,e)=>E.metrics(list.map(r=>r.predictions[e]));
const group=(key)=>Object.fromEntries([...new Set(complete.map(key))].sort().map(k=>{
 const arr=complete.filter(r=>key(r)===k);
 return [k,{n:arr.length,metrics:Object.fromEntries(WAYS.map(e=>[e,metric(arr,e)]))}];
}));
function stageFromLabel(str){
 const s=String(str||'').normalize('NFKC');
 if(/準決|準々決|予選/.test(s))return '勝ち上がり戦';
 if(/決勝/.test(s))return '決勝';
 if(/初特選|初日特選/.test(s))return '初日特選';
 if(/特選|特秀|特優|特別優秀/.test(s))return '特選等';
 if(/一般|特一般|選抜/.test(s))return '敗者戦';
 return 'その他';
}
for(const r of complete)r.published_stage=stageFromLabel(r.stage_label);
const report={
 schema:'tk-keirin-fullcard-retrospective-60-eight-engine-pilot/v1',generated_at:new Date().toISOString(),
 input:{sample_n:prepared.sample_n,source_ready:prepared.prepared_n,
  prepared_statuses:prepared.status_counts,all_ways_generated:complete.length,attempted_rows:rows.length,
  models:WAYS,excluded_from_all_ways:rows.length-complete.length,failures},
 methodology:{
  source:'Published K-Dreams historical race-line prediction, archived Kenseimk pre-race competition scores and class, K-Dreams recorded start time, Kenseimk trifecta payout.',
  selection:'Original 50 were selected per month and race-type before payout, plus S9 hashed one per month; no payoff selection.',
  model:'2026-11-16 current source code retrospectively executed against 2025-11 to 2026-08 pre-race source fields; NOT the original race-day model nor frozen prediction',
  payout:'3連単100円均等・全エンジン同じレース。',
  bias:'Small stratified sample and historic incomplete source features; no 2025-2026 annual ROI inference or bet-selection rules.',
  reporting:'Use common complete-case only, and trim1/5 for jackpot-dependence. No claim of forward profits.'
 },
 common:{n:complete.length,by_engine:Object.fromEntries(WAYS.map(e=>[e,metric(complete,e)]))},
 by_category:group(r=>r.category),
 by_published_stage:group(r=>r.published_stage),
 by_category_stage:group(r=>r.category+'|'+r.published_stage),
 by_month:group(r=>r.date.slice(0,7)),
 rows:complete.map(r=>({race_id:r.race_id,date:r.date,category:r.category,stage:r.published_stage,
  source_url:r.source_url,modelIds:r.modelIds,predictions:r.predictions}))
};
const f=path.join(base,'historical-60-eight-engine-summary.json');fs.writeFileSync(f,JSON.stringify(report,null,2)+'\n');
const short={scope:report.input,
 overall:Object.fromEntries(WAYS.map(k=>[k,{roi:report.common.by_engine[k].roi,trim1:report.common.by_engine[k].trim1,trim5:report.common.by_engine[k].trim5,hits:report.common.by_engine[k].hits}])),
 stage:Object.entries(report.by_published_stage).map(([name,v])=>({name,n:v.n,auto:v.metrics.auto.roi,auto_trim1:v.metrics.auto.trim1,auto_trim5:v.metrics.auto.trim5}))};
console.log('YEAR_8ENGINE_SMALL_SAMPLE',JSON.stringify(short,null,2));
