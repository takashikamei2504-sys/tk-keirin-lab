#!/usr/bin/env node
'use strict';
// Exact 240-cohort holdout recovery after upstream 2026-08-17 archive rollover.
// Only historical replay; these are not contemporaneous pre-race predictions.
const fs=require('node:fs'),path=require('node:path');
const E=require('../js/b-upset/evaluation.cjs');
const DIR=path.resolve(process.argv[2]||'reports/final-day/shards');
const OUT=path.resolve(process.argv[3]||'reports/final-day/recovered-1286.json');
const FROZEN=path.resolve('reports/final-day/frozen-development-240.json');
const WAYS=['auto','physical','causal','lab_v5','line','roi_coverage','b_upset_ad','b_upset_expanded'];
const FIXED={'A級_7':'causal','S級_7':'physical','S級_9':'b_upset_ad','チャレンジ_7':'b_upset_expanded'};
const must=(check,msg)=>{if(!check)throw Error(msg)};
const f=JSON.parse(fs.readFileSync(FROZEN,'utf8'));
const originalIDs=new Set(f.selected_races.map(r=>r.race_id));
must(originalIDs.size===240&&f.origin.original_eligible===1298,'Original frozen 240 is not valid');
const rows=[],ids=new Set(),ranks=new Set(),issues=[];
for(let i=0;i<6;i++){
 const p=JSON.parse(fs.readFileSync(path.join(DIR,'part-'+i+'.json'),'utf8'));
 must(p.scope?.eligible===1286&&p.scope?.offset===i*217,'Unexpected archive count/offset '+i);
 must(JSON.stringify(p.scope?.missing_days)==='["2026-08-16","2026-08-17"]','Archive missing-days drift '+i);
 must(!p.scope?.fetch_errors?.length,'Archive fetch error '+i);
 for(const r of p.races){
  must(!ids.has(r.race_id)&&!ranks.has(r.sample_rank),'Duplicated race/rank '+r.race_id);
  must(r.sample_rank>=0&&r.sample_rank<1286,'Invalid rank '+r.race_id);
  for(const mode of WAYS)must(r.predictions?.[mode]!=null,'Missing engine '+mode+' in '+r.race_id);
  ids.add(r.race_id);ranks.add(r.sample_rank);rows.push({...r,original_partition:originalIDs.has(r.race_id)?'development_240':'holdout_1058'});
 }
 for(const [name,v] of Object.entries(p.failures||{}))issues.push({shard:i,name,count:v.count,examples:v.examples||[]});
}
must(rows.length===1286&&ranks.size===1286,'Incomplete source inventory');
for(let i=0;i<1286;i++)must(ranks.has(i),'Missing rank '+i);
rows.sort((a,b)=>a.date.localeCompare(b.date)||a.venue.localeCompare(b.venue)||a.race_no-b.race_no);
const development=rows.filter(r=>r.original_partition==='development_240');
const holdout=rows.filter(r=>r.original_partition==='holdout_1058');
const unavailable=f.selected_races.filter(r=>!ids.has(r.race_id));
must(development.length===238&&holdout.length===1048,'Original cohort changed '+development.length+'/'+holdout.length);
must(unavailable.length===2&&unavailable.every(r=>r.date==='2026-08-17'),'Original development archive drift');
must(development.every(r=>r.sample_rank<238)&&holdout.every(r=>r.sample_rank>=238),'Original cohort hash order drift');
const norm=x=>({...x,net:x.payout-x.stake});
const metric=(arr,mode)=>E.metrics(arr.map(r=>norm(mode?r.predictions[mode]:r)));
const top3=arr=>{
 const payouts=arr.filter(r=>r.payout>0).sort((a,b)=>b.payout-a.payout).slice(0,3);
 const s=arr.reduce((n,r)=>n+r.stake,0)-payouts.reduce((n,r)=>n+r.stake,0);
 const p=arr.reduce((n,r)=>n+r.payout,0)-payouts.reduce((n,r)=>n+r.payout,0);
 return s?p/s:null;
};
const section=arr=>({races:arr.length,complete:arr.filter(r=>WAYS.every(n=>r.predictions[n])).length,
 engines:Object.fromEntries(WAYS.map(n=>[n,{...metric(arr,n),trim3:top3(arr.map(r=>r.predictions[n]))}]))});
const chosen=arr=>arr.map(r=>norm(r.predictions[FIXED[r.category]]));
const fixedSection=arr=>({...E.metrics(chosen(arr)),trim3:top3(chosen(arr))});
const grouped=(fn)=>Object.fromEntries([...new Set(holdout.map(fn))].sort().map(k=>{
 const rs=holdout.filter(r=>fn(r)===k);return [k,{races:rs.length,chosen:fixedSection(rs),engines:section(rs).engines}];
}));
const byCategory={};
for(const grade of Object.keys(FIXED)){
 const d=development.filter(r=>r.category===grade),h=holdout.filter(r=>r.category===grade);
 const old=f.development_summary[grade];
 must(old?.races>=1,'Missing old grade '+grade);
 byCategory[grade]={selected:FIXED[grade],old_development_n:old.races,
  old_development:old.engines[FIXED[grade]],current_development_n:d.length,current_development:metric(d,FIXED[grade]),
  holdout_n:h.length,holdout:fixedSection(h),engines:section(h).engines};
}
const oldStake=Object.values(byCategory).reduce((s,g)=>s+g.old_development.stake,0);
const oldPayout=Object.values(byCategory).reduce((s,g)=>s+g.old_development.payout,0);
const report={
 schema:'tk-keirin-final-day-holdout-archive-recovery/v1',
 generated_at:new Date().toISOString(),
 methodological_status:'Retrospective current-code replay of historic cards, not pre-race timestamped forecasts',
 source:'kurinaka12-afk/keirin-app-data, publicly available daily JSON as of 2026-11-16',
 scope:{original_eligible:1298,now_accessible:1286,original_development:240,accessible_development:238,
  original_holdout:1058,accessible_holdout:1048,original_development_missing_ids:unavailable.map(r=>r.race_id),
  original_holdout_missing:10,unavailable_archive_dates:['2026-08-16','2026-08-17'],
  original_sample:'SHA256(race_id|final-day-v1), earliest 240 on original 1298, held frozen',
  complete_8_engines:rows.filter(r=>WAYS.every(n=>r.predictions[n])).length,failures:issues},
 rules:FIXED,
 old_frozen_240:{n:240,stake:oldStake,payout:oldPayout,roi:oldStake?oldPayout/oldStake:null},
 accessible_development_238:section(development),
 holdout_1048:section(holdout),
 selected_1048:fixedSection(holdout),
 by_category:byCategory,
 by_category_round:grouped(r=>r.category+'|'+r.round),
 by_category_month:grouped(r=>r.category+'|'+r.date.slice(0,7)),
 by_month:grouped(r=>r.date.slice(0,7)),
 selected_top_wins:holdout.map(r=>({race_id:r.race_id,category:r.category,round:r.round,model:FIXED[r.category],payout:r.predictions[FIXED[r.category]].payout})).filter(r=>r.payout>0).sort((a,b)=>b.payout-a.payout).slice(0,15),
 caveats:[
 'An upstream public archive history rewrite removed 2026-08-17 after original 1298 inventory was constructed.',
 'Ten original holdout races and two original development races on that date cannot be rerun from current public feed.',
 'Original development modes are frozen; holdout outcomes are not used to select or revise them.',
 'Current engine source code matches original replay for core engine/feed/evaluation modules; older daily source content is not independently snapshotted.',
 'Source payout entries are not independently cross-checked to official records.',
 'Nominally profitable ROI from retroactive replay does not validate real pre-race performance; multiple comparisons and top-payout volatility matter.'
 ],
 races:rows
};
fs.mkdirSync(path.dirname(OUT),{recursive:true});
fs.writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({scope:report.scope,original_240:report.old_frozen_240,selected_1048:report.selected_1048,
 by_category:Object.fromEntries(Object.entries(byCategory).map(([k,v])=>[k,{n:v.holdout_n,mode:v.selected,roi:v.holdout.roi,trim1:v.holdout.trim1,trim3:v.holdout.trim3,trim5:v.holdout.trim5}]))},null,2));
