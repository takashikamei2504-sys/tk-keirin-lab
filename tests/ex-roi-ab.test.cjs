'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Ex=require('../js/ex-profile.js');
const Brain=require('../js/race-brain.js');
const Shadow=require('../js/ex-roi/shadow.cjs');
const Freeze=require('../scripts/ex-ab-freeze.cjs');
const Evaluate=require('../scripts/ex-ab-evaluate.cjs');
const date='2026-10-31',asOf='2026-10-30T02:00:00Z';
const race=JSON.parse(fs.readFileSync(path.join(__dirname,'../race_sample.json'),'utf8'));
race.riders.find(r=>r.no===1).meta={rider_id:'14838'};
race.class='S級決勝';race.ex_context={track_length:400,weather:'晴',weather_source_verified:true,
  time_band:'day',time_band_source_verified:true};
const source='https://www.winticket.jp/keirin/hofu/racecard/2026103063/2/12';
function axis(a,b){return {a:{opportunities:50,wins:25,top3:40},
 [b]:{opportunities:40,wins:2,top3:8}};}
const row={source_url:source,published_at:asOf,collected_at:asOf,
 metrics:{kamashi:{events:40,opportunities:45},tsuppari:{events:42,opportunities:50},
 chigiri:{events:18,opportunities:30},chigirarare:{events:2,opportunities:60},
 tobitsuki:{events:15,opportunities:20},seri:{events:20,opportunities:25}},
 contextual:{
  position:{leader:{opportunities:50,wins:25,top3:40},second:{opportunities:40,wins:2,top3:8}},
  race_type:{final:{opportunities:40,wins:19,top3:29},qualifying:{opportunities:60,wins:4,top3:13}},
  bank_length:{'400':{opportunities:35,wins:15,top3:26},'333':{opportunities:40,wins:4,top3:10}},
  weather:{sun:{opportunities:50,wins:25,top3:40},rain:{opportunities:35,wins:4,top3:11}},
  time_band:{day:{opportunities:35,wins:15,top3:26},night:{opportunities:40,wins:4,top3:10}}
 }};
const pack={schema:'tk-b-axis-ex-observations/v1',license_status:Ex.APPROVAL,
 redistribution_approved:true,riders:{14838:row}};
assert.equal(Ex.contextResidual(row,'weather','sun').n,50);
const p={finish:.5,track:.5,measurements:[],basis:'test'};
Ex.attach(p,race.riders.find(r=>r.no===1),race,pack,Date.parse(asOf));
assert.equal(p.ex_used,6);
assert.equal(p.ex_context_used,5);
assert(p.ex_context_residual>0&&p.ex_context_residual<=.035);
assert(p.ex_chigirarare_delta<0);
assert(p.track>.5);
const unverified={...pack,redistribution_approved:false};
assert.equal(Ex.record(unverified,race.riders.find(r=>r.no===1),race,Date.parse(asOf)),null);
assert.equal(Ex.record(pack,race.riders.find(r=>r.no===1),race,Date.parse('2026-10-29T00:00Z')),null);
assert.equal(Ex.record(pack,race.riders.find(r=>r.no===1),{...race,date:'2026-10-29'},Date.parse(asOf)),null);
const a=Brain.build(race),b=Brain.build(race,{exPack:pack,exAsOf:Date.parse(asOf)});
const before=Shadow.select(a),after=Shadow.select(b),delta=Shadow.diff(before,after);
assert.equal(before.length,8);assert.equal(after.length,8);
assert.equal(new Set(after.map(t=>t.key)).size,8);
assert(after.every(t=>t.key===t.trio.join('-')));
assert.equal(b.profiles['1'].ex_used,6);
assert.equal(a.profiles['1'].ex_used,undefined);
assert.deepEqual(Shadow.select(a),before,'stable baseline');
const freeze=Freeze.versions(race,pack,Date.parse(asOf));
assert.equal(freeze.applied.length,1);
assert.equal(freeze.baseline.length,8);
assert.equal(freeze.ex.length,8);
assert.equal(freeze.applied[0].no,1);
const winner=[{key:before[0].key,trio:before[0].trio}];
assert.equal(Shadow.accuracy(before,winner).trifecta,true);
assert.equal(Shadow.accuracy([],winner).pair,false);
const make=(i,bonus=true)=>{
 const day=new Date(Date.parse('2026-11-01T00:00:00Z')+Math.floor(i/14)*86400000).toISOString().slice(0,10);
 const baseline={status:'evaluated',cutoff:day+'T09:00:00+09:00',
   race_id:day+':V:'+i,points:8,refunded:0,wins:[],void:false,actualPayouts:[1200],first:false,pair:false};
 const ex={...baseline,wins:bonus?[1300]:[],first:bonus,pair:bonus};
 return {model_id:'test',race_id:baseline.race_id,status:'evaluated',
   date:day,baseline,ex,changed:true,paired_net_delta:bonus?1300:0};
};
const sample=Array.from({length:210},(_,i)=>make(i));
const report=Evaluate.summarize(sample,'test');
assert.equal(report.evaluated,210);
assert.equal(report.confidence.days,15);
assert.equal(report.baseline.roi,0);
assert.equal(report.ex.roi,1300/800);
assert.equal(report.delta.pair_capture,1);
assert.equal(report.ready_for_review,true);
assert.equal(report.auto_buy_enabled,false);
assert.equal(Evaluate.summarize(sample.slice(0,100),'test').ready_for_review,false);
assert.equal(Evaluate.summarize(sample.map((r,i)=>({...r,paired_net_delta:i%2?0:1300})), 'test').confidence.days,15);
const bad=[...sample];bad[0]={...bad[0],baseline:{...bad[0].baseline,wins:[60000]},
 paired_net_delta:-58700};
assert.equal(Evaluate.summarize(bad,'test').ready_for_review,false,'outlier fails robust lower bound or trim');
console.log('EX_ROI_AB_TESTS_OK '+JSON.stringify({synthetic:210,days:15,
  modelEX:p.ex_used,contextEX:p.ex_context_used,selected:before.length,
  changed:delta.changed.length,decision:'shadow_only'}));
