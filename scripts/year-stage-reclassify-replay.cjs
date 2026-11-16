#!/usr/bin/env node
'use strict';
// Reclassify already replayed, unchanged 8-engine choices using external validation:
// day 1 "選抜" is 初特選, whereas subsequent-day "選抜" is not.
// NO prediction is regenerated or selected based on outcome.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Metrics=require('../js/b-upset/evaluation.cjs');
const file=path.join(__dirname,'../reports/year-race-type/replay-available-quarter-summary.json');
const input=fs.readFileSync(file);
const o=JSON.parse(input);
const WAYS=['auto','physical','causal','lab_v5','line','roi_coverage','b_upset_ad','b_upset_expanded'];
if(o.scope?.sample_races!==833||o.rows?.length!==833)throw Error('Input 833-race replays not present');
function stage(r){
 const round=String(r.round||'').normalize('NFKC').replace(/\s/g,'');
 if(round.includes('決勝'))return '決勝';
 if(r.meeting_day==='初日'&&/^(選抜|特別選抜|初日特選|特選)$/.test(round))return '初日特選';
 if(/準決|準々決|予選|勝上/.test(round))return '勝ち上がり戦';
 if(/特別選抜|特選|特秀|特優/.test(round))return '特選等';
 if(/一般|特一般|選抜|敗者|順位/.test(round))return '敗者戦';
 return 'その他';
}
function metric(rows,name){
 const r=rows.map(x=>x.predictions[name]);
 if(r.some(x=>!x))throw Error('Missing predictions in '+name);
 return Metrics.metrics(r.map(x=>({...x,net:x.payout-x.stake})));
}
const rows=o.rows.map(r=>({...r,stage:stage(r)}));
for(const name of WAYS){
 const a=metric(rows,name),b=o.all.engines[name];
 if(a.n!==b.n||a.stake!==b.stake||a.payout!==b.payout||a.hits!==b.hits)throw Error('Engine invariants changed: '+name);
}
const oldnew=rows.reduce((a,r)=>{const original=o.rows.find(p=>p.race_id===r.race_id)?.stage||'missing';a[original+' -> '+r.stage]=(a[original+' -> '+r.stage]||0)+1;return a;},{});
const group=fn=>Object.fromEntries([...new Set(rows.map(fn))].sort().map(k=>{
 const rs=rows.filter(r=>fn(r)===k);
 return [k,{n:rs.length,by_engine:Object.fromEntries(WAYS.map(name=>[name,metric(rs,name)]))}]
}));
const report={
 schema:'tk-keirin-race-stage-replay-corrected/v1',
 generated_at:new Date().toISOString(),
 input_file:'reports/year-race-type/replay-available-quarter-summary.json',
 input_sha256:crypto.createHash('sha256').update(input).digest('hex'),
 scope:o.scope,
 methodology:{
  correction:'Initial-day published 選抜 is 初日特選 (verified against independent race programs for Yokkaichi G3, Kawasaki F1, Aomori F1, Takeo F1). On later days 選抜 is loser-side.',
  distinction:'Special selection races after initial day are in 特選等, never indiscriminately grouped as loser races.',
  unchanged:'Same race IDs, same 8 engine tickets and stakes/payouts, no re-generation and no outcome-based selection.',
  caution:'833-race prospective-of-categories research sample, retrospective current-code historical replay, NOT 1-year engine backtest.'
 },
 total:{n:rows.length,by_engine:Object.fromEntries(WAYS.map(k=>[k,metric(rows,k)]))},
 label_corrections:oldnew,
 by_grade_stage:group(r=>r.category+'|'+r.stage),
 by_stage:group(r=>r.stage),
 by_grade:group(r=>r.category),
 by_grade_stage_month:group(r=>r.category+'|'+r.stage+'|'+r.date.slice(0,7)),
};
const out=path.join(__dirname,'../reports/year-race-type/replay-stages-corrected-833.json');
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
const stdout=Object.entries(report.by_grade_stage).map(([name,g])=>({
 name,n:g.n,top:Object.entries(g.by_engine).map(([engine,v])=>({
 engine,roi:Math.round(v.roi*1000)/10,trim1:Math.round(v.trim1*1000)/10,trim5:Math.round(v.trim5*1000)/10,hits:v.hits
 })).sort((a,b)=>b.roi-a.roi).slice(0,3)
}));
console.log('CORRECTED_RACE_STAGES',JSON.stringify({changes:oldnew,group:stdout},null,2));
