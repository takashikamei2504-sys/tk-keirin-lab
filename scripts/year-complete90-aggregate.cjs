#!/usr/bin/env node
'use strict';
/* Full inventory 2026-08-18..2026-11-15, all eligible races, eight current-model
   retrospective replays; source SHA fixed; no bets or production modifications.
*/
const fs=require('node:fs'),path=require('node:path'),E=require('../js/b-upset/evaluation.cjs');
const root=path.resolve(__dirname,'../reports/year-race-type'),dir=path.join(root,'complete90-shards');
const WAYS=['auto','physical','causal','lab_v5','line','roi_coverage','b_upset_ad','b_upset_expanded'];
const SHARDS=18;
const all=[],seen=new Set(),days=new Set(),hashes={},inputs={source_invalid:0};
const jobs=[],failures={};let nseen=0,nmale=0,eligible=0;
for(let i=0;i<SHARDS;i++){
 const file=path.join(dir,'part-'+i+'.json');
 const o=JSON.parse(fs.readFileSync(file,'utf8'));
 if(o.schema!=='tk-keirin-90day-complete-eight-way-replay-shard/v1'||o.scope.shard!==i||o.scope.days!==5||o.rows?.length!==o.scope.rows||o.scope.archive_commit!=='4588ec938a2fec9e81216d3fd3423329805aa3d5')throw Error('Shard schema/size/commit mismatch '+i);
 const expectedStart=new Date(Date.parse('2026-08-18T00:00:00Z')+i*5*86400000).toISOString().slice(0,10);
 if(o.scope.start!==expectedStart)throw Error('Incomplete date partition '+i+' '+o.scope.start);
 for(const [date,sha] of Object.entries(o.scope.day_sha256)){
  if(days.has(date)||!(/^[0-9a-f]{64}$/.test(sha)))throw Error('Duplicate day or bad digest '+date);
  days.add(date);hashes[date]=sha;
 }
 nseen+=o.scope.program_seen.all_program_races||0;
 nmale+=o.scope.program_seen.male_seven_nine||0;
 eligible+=o.scope.eligible;
 inputs.source_invalid+=(o.scope.program_seen.invalid_card_or_result||0);
 for(const [type,x] of Object.entries(o.failures||{})){const record=failures[type]??={count:0,samples:[]};record.count+=x.count||0;record.samples.push(...(x.examples||[]).slice(0,1));}
 for(const r of o.rows){
  if(seen.has(r.race_id))throw Error('Repeated race ID '+r.race_id);
  seen.add(r.race_id);
  if(!WAYS.every(k=>r.predictions?.[k]))throw Error('Incomplete engine '+r.race_id+' '+Object.keys(r.predictions).join(','));
  all.push(r);
 }
 jobs.push({shard:i,days:o.scope.days,candidates:o.scope.male_candidate,eligible:o.scope.eligible,engine_complete:o.scope.complete});
}
if(days.size!==90||all.length!==eligible)throw Error('Not all available source days/races accounted');
const dateList=[...days].sort();
for(let i=0;i<90;i++){
 const date=new Date(Date.parse('2026-08-18T00:00:00Z')+i*86400000).toISOString().slice(0,10);
 if(date!==dateList[i])throw Error('Date gap '+date);
}
all.sort((a,b)=>a.date.localeCompare(b.date)||a.race_id.localeCompare(b.race_id));
function metrics(rows,e){return E.metrics(rows.map(r=>r.predictions[e]));}
function pack(rows){return {races:rows.length,engines:Object.fromEntries(WAYS.map(e=>[e,metrics(rows,e)]))};}
function group(fn){return Object.fromEntries([...new Set(all.map(fn))].sort().map(k=>[k,pack(all.filter(r=>fn(r)===k))]));}
const out={
 schema:'tk-keirin-90day-exhaustive-fullrace-eight-engine-report/v1',
 generated_at:new Date().toISOString(),days:90,start:dateList[0],end:dateList.at(-1),
 source:{github_repository:'kurinaka12-afk/keirin-app-data',
  pinned_commit:'4588ec938a2fec9e81216d3fd3423329805aa3d5',day_sha256:hashes,
  truncated_or_sampled:false,race_census:'all 7/9-car male valid paid races from 90 daily JSON objects'},
 methodology:{ticket:'100 yen per unique trifecta combination, variable number of tickets per engine',
  cohort:'Same exact races all 8 engines, no performance-based filtering',
  status:'2026-11-16 current code retrospectively applied, not pre-race frozen at race-day',
  limitations:'Only 2026-08-18..2026-11-15. Historical published lineup can be changed after race. This is NOT a 1-year or forward ROI, and published data are not official independently audited.'},
 counts:{all_source_races:nseen,male7_9:nmale,eligible_with_eight:nmale?all.length:0,skipped_invalid:inputs.source_invalid},
 failures,job_counts:jobs,all:pack(all),
 by_category:group(r=>r.category),
 by_stage:group(r=>r.stage),
 by_category_stage:group(r=>r.category+'|'+r.stage),
 by_category_round:group(r=>r.category+'|'+r.round),
 by_category_stage_month:group(r=>r.category+'|'+r.stage+'|'+r.date.slice(0,7)),
 by_month:group(r=>r.date.slice(0,7)),
 by_meeting_day:group(r=>r.meeting_day),
 races:all
};
const file=path.join(root,'complete90-eight-engine-audit.json');
fs.writeFileSync(file,JSON.stringify(out)+'\n');
const light={schema:'tk-keirin-90day-exhaustive-summary/v1',
 dates:{start:out.start,end:out.end,days:90},counts:out.counts,source_commit:out.source.pinned_commit,
 methodology:out.methodology,overall:out.all,by_category:out.by_category,by_stage:out.by_stage,
 by_category_stage:out.by_category_stage,by_month:out.by_month,failures:out.failures};
fs.writeFileSync(path.join(root,'complete90-summary.json'),JSON.stringify(light,null,2)+'\n');
console.log('COMPLETE_90DAY_ALL_RACE',JSON.stringify({counts:out.counts,engines:Object.fromEntries(WAYS.map(e=>[e,{ROI:out.all.engines[e].roi,hits:out.all.engines[e].hits,trim5:out.all.engines[e].trim5}])),
 groups:Object.fromEntries(Object.entries(out.by_category_stage).map(([k,v])=>[k,{n:v.races,auto_roi:v.engines.auto.roi}])),failures:out.failures}).slice(0,14000));
