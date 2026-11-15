#!/usr/bin/env node
'use strict';
// Aggregate independent outcome-blind historical replay shards (never live forecasts).
const fs=require('node:fs'),path=require('node:path');
const E=require('../js/b-upset/evaluation.cjs');
const WAYS=['auto','physical','causal','lab_v5','line','roi_coverage','b_upset_ad','b_upset_expanded'];
const DIR=path.resolve(process.argv[2]||'reports/final-day/shards');
const OUT=path.resolve(process.argv[3]||'reports/final-day/holdout-1298.json');
const FILES=Array.from({length:6},(_,i)=>path.join(DIR,'part-'+i+'.json'));
const parts=FILES.map(f=>JSON.parse(fs.readFileSync(f,'utf8')));
const rows=[],ids=new Set(),ranks=new Set(),failures={};
for(let i=0;i<parts.length;i++){
 const p=parts[i];if(p.scope?.eligible!==1298||p.scope?.offset!==i*217||p.scope?.holdout_partition_verified!==true)throw Error('Historical inventory/partition mismatch '+i);
 if(p.scope?.fetch_errors?.length||p.scope?.missing_days?.join(',')!=='2026-08-16')throw Error('Archive continuity changed '+i);
 for(const [k,v] of Object.entries(p.failures||{})){(failures[k]??={count:0,examples:[]}).count+=v.count;failures[k].examples.push(...(v.examples||[]).slice(0,2));}
 for(const r of p.races){
  if(ids.has(r.race_id)||ranks.has(r.sample_rank))throw Error('Duplicate race or hash rank '+r.race_id);
  if(r.partition!==(r.sample_rank<240?'development_240':'holdout_1058'))throw Error('Wrong partition '+r.race_id);
  ids.add(r.race_id);ranks.add(r.sample_rank);rows.push(r);
 }
}
if(rows.length!==1298||[...Array(1298)].some((_,i)=>!ranks.has(i)))throw Error('Missing replay ranks '+rows.length);
rows.sort((a,b)=>a.date.localeCompare(b.date)||a.venue.localeCompare(b.venue)||a.race_no-b.race_no);
const settle=r=>({...r,net:r.payout-r.stake});
const metric=(rs,name)=>E.metrics(rs.filter(r=>r.predictions?.[name]).map(r=>settle(r.predictions[name])));
const section=rs=>({races:rs.length,complete:rs.filter(r=>WAYS.every(k=>r.predictions?.[k])).length,
 engines:Object.fromEntries(WAYS.map(k=>[k,metric(rs,k)]))});
const group=fn=>Object.fromEntries([...new Set(rows.map(fn))].sort().map(k=>[k,section(rows.filter(r=>fn(r)===k))]));
const fixed={'A級_7':'causal','S級_7':'physical','S級_9':'b_upset_ad','チャレンジ_7':'b_upset_expanded'};
const fixedReport=rs=>{
 const purchase=rs.filter(r=>r.predictions?.[fixed[r.category]]);
 return {races:rs.length,complete:purchase.length,metrics:E.metrics(purchase.map(r=>settle(r.predictions[fixed[r.category]])))};
};
const dev=rows.filter(r=>r.partition==='development_240'),hold=rows.filter(r=>r.partition==='holdout_1058');
const decisions={};
for(const category of [...new Set(rows.map(r=>r.category))].sort()){
 const training=dev.filter(r=>r.category===category),testing=hold.filter(r=>r.category===category);
 const choices=WAYS.map(mode=>({mode,measure:metric(training,mode)})).filter(x=>x.measure.n===training.length&&x.measure.roi!==null);
 // Strategy chosen strictly from training 240 (trim1 is preferred to gross ROI), no testing outcomes used.
 choices.sort((a,b)=>(b.measure.trim1??-1)-(a.measure.trim1??-1)||b.measure.roi-a.measure.roi||a.mode.localeCompare(b.mode));
 const mode=training.length>=20&&testing.length>=30?choices[0]?.mode:null;
 decisions[category]={development_n:training.length,holdout_n:testing.length,mode:mode||null,criterion:'max development trim1 ROI; min 20/30',development:mode?metric(training,mode):null,holdout:mode?metric(testing,mode):null,
 previously_proposed_mode:fixed[category]||null,previously_proposed_holdout:fixed[category]?metric(testing,fixed[category]):null};
}
const report={schema:'tk-keirin-final-day-replay-holdout/v1',generated_at:new Date().toISOString(),
 provenance:{source_repo:'kurinaka12-afk/keirin-app-data',from:'2026-08-16',to:'2026-11-07',
 final_day_rule:'venue_info[venue].meeting_day === 最終日',race_filter:'original final-day loss rounds; male 7/9 cars',expected_n:1298,
 partition:'SHA256(race_id | final-day-v1) ascending; ranks 0..239 development, ranks 240..1297 holdout',
 character:'retrospective current-code replay; not actual pre-race frozen predictions',cost:'100 JPY per unique trifecta ticket; 8 variants on same race cards',
 caveat:'No verified pre-race timestamp for archived basic cards. Ex-post engine tuning risks remain. Do not conflate high ROI with forward profitability.'},
 scope:{total:rows.length,development:dev.length,holdout:hold.length,all_eight_complete:rows.filter(r=>WAYS.every(k=>r.predictions?.[k])).length,failures},
 ways:WAYS,development:section(dev),holdout:section(hold),all:section(rows),by_category:group(r=>r.category),
 by_category_round:group(r=>r.category+'|'+r.round),
 by_partition_category:group(r=>r.partition+'|'+r.category),
 by_partition_category_round:group(r=>r.partition+'|'+r.category+'|'+r.round),
 fixed_240_choice:{rules:fixed,development:fixedReport(dev),holdout:fixedReport(hold)},
 train_selected:decisions,races:rows};
fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({scope:report.scope,fixed_240_choice:report.fixed_240_choice,train_selected:report.train_selected,
 holdout:Object.fromEntries(WAYS.map(m=>[m,{roi:report.holdout.engines[m].roi,trim1:report.holdout.engines[m].trim1,n:report.holdout.engines[m].n}]))},null,2));
