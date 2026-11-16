#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),M=require('../js/b-upset/evaluation.cjs');
const WAYS=['auto','physical','causal','lab_v5','line','roi_coverage','b_upset_ad','b_upset_expanded'];
const ROOT=path.resolve(__dirname,'../reports/year-race-type'),parts=Array.from({length:8},(_,i)=>path.join(ROOT,'shards','part-'+i+'.json'));
const P=parts.map(f=>JSON.parse(fs.readFileSync(f,'utf8')));
const rows=[],ids=new Set(),ranks=new Set(),failures={};
for(let i=0;i<P.length;i++){
 const p=P[i];if(p.schema!=='tk-keirin-race-types-exploratory-replay/v1'||p.scope.shard_offset!==i*200||p.scope.stage_cap!==75)throw Error('Wrong source scope '+i);
 if(p.scope.fetch_errors?.length||p.scope.valid_races!==P[0].scope.valid_races||p.scope.selected_total!==P[0].scope.selected_total||JSON.stringify(p.scope.strata)!==JSON.stringify(P[0].scope.strata))throw Error('Source inventory drift '+i);
 for(const [key,v] of Object.entries(p.failures||{}))(failures[key]??={count:0,examples:[]}).count+=v.count;
 for(const r of p.races){
  if(ids.has(r.race_id)||ranks.has(r.sample_rank))throw Error('Duplicate race '+r.race_id);
  if(r.sample_rank<0||r.sample_rank>=p.scope.selected_total)throw Error('Sample rank outside bounds');
  if(WAYS.some(k=>!r.predictions?.[k]))throw Error('Missing engine in '+r.race_id);
  ids.add(r.race_id);ranks.add(r.sample_rank);rows.push(r);
 }
}
const expected=P[0].scope.selected_total;
if(rows.length!==expected)throw Error('Incomplete sample '+rows.length+' / '+expected);
for(let i=0;i<expected;i++)if(!ranks.has(i))throw Error('Missing sample rank '+i);
rows.sort((a,b)=>a.date.localeCompare(b.date)||a.venue.localeCompare(b.venue)||a.race_no-b.race_no);
const metric=(rs,k)=>M.metrics(rs.map(r=>({...r.predictions[k],net:r.predictions[k].payout-r.predictions[k].stake})));
const all=rs=>({races:rs.length,engines:Object.fromEntries(WAYS.map(k=>[k,metric(rs,k)]))});
const grouped=fn=>Object.fromEntries([...new Set(rows.map(fn))].sort().map(k=>[k,all(rows.filter(r=>fn(r)===k))]));
const summary={
 schema:'tk-keirin-year-stage-partial-sample/v1',generated_at:new Date().toISOString(),
 scope:{start:P[0].scope.start,end:P[0].scope.end,source:P[0].scope.source,available_days:P[0].scope.available_days,
  sample_races:rows.length,original_valid_races:P[0].scope.valid_races,stage_cap:P[0].scope.stage_cap,
  strata:P[0].scope.strata,missing_days:P[0].scope.missing_days,failures},
 methods:P[0].methodologies,
 disclaimer:'Only publicly available ~3 month subperiod, NOT full requested 2025-11 to 2026-11 annual period. Result-after-archive replay, exploratory only.',
 engines:WAYS,all:all(rows),by_grade_stage:grouped(r=>r.category+'|'+r.stage),
 by_stage:grouped(r=>r.stage),by_grade:grouped(r=>r.category),
 by_grade_round:grouped(r=>r.category+'|'+r.round),
 by_grade_stage_month:grouped(r=>r.category+'|'+r.stage+'|'+r.date.slice(0,7)),
 by_meeting_day:grouped(r=>r.meeting_day),
 rows
};
fs.writeFileSync(path.join(ROOT,'replay-available-quarter-summary.json'),JSON.stringify(summary,null,2)+'\n');
const headline=Object.entries(summary.by_grade_stage).filter(([k,v])=>v.races>=15).map(([k,v])=>({grade_stage:k,n:v.races,top:Object.entries(v.engines).map(([engine,m])=>({engine,roi:m.roi,hits:m.hits,trim1:m.trim1,trim5:m.trim5})).sort((a,b)=>b.roi-a.roi).slice(0,3)}));
console.log(JSON.stringify({scope:summary.scope,groups:headline,overall:Object.fromEntries(WAYS.map(k=>[k,summary.all.engines[k].roi]))},null,2));
