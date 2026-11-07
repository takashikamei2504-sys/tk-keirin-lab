'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Audit = require('../js/roi/audit.cjs');
const History = require('./history-store.cjs');
const Shadow = require('./roi-shadow-report.cjs');
const {save} = require('./roi-audit.cjs');

function monitor(data) {
  const dir = path.join(data,'roi','forecasts');
  const lab = path.join(data,'lab_history');
  const summaries = {}, shadowGroups = {};
  const status = {pending:0,unmatched:0};
  const days = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n=>/^\d{4}-\d{2}-\d{2}$/.test(n)) : [];
  for (const day of days) {
    const history = History.load(lab,day);
    const results = new Map(history.results.map(r=>[r.race_id,r]));
    const baseline = new Map(history.predictions.map(p=>[p.race_id+'|'+p.model_id,p]));
    const forecastDir = path.join(dir,day);
    for (const name of fs.readdirSync(forecastDir).filter(n=>/^[a-f0-9]{64}\.json$/.test(n))) {
      const frozen = JSON.parse(fs.readFileSync(path.join(forecastDir,name),'utf8'));
      if (!(Date.parse(frozen.saved_at)<Date.parse(frozen.cutoff)) || !frozen.model?.configuration_hash) continue;
      const shadow = frozen.shadow && (shadowGroups[frozen.model.model_id] ||= Shadow.create());
      if (shadow) {
        const reason = frozen.shadow.mixed.reason;
        shadow.gates[reason] = (shadow.gates[reason] || 0) + 1;
      }
      const result = results.get(frozen.race_id);
      if (!result) { status.pending++; if (shadow) shadow.pending++; continue; }
      const p = baseline.get(frozen.race_id+'|'+frozen.evidence.lab.model);
      if (!p || p.saved_at!==frozen.evidence.lab.saved_at ||
          p.input_sha256!==frozen.evidence.lab.hash || p.cutoff!==frozen.cutoff) { status.unmatched++; continue; }
      if (shadow) Shadow.add(shadow,frozen.shadow,p,result);
      const group = summaries[frozen.model.model_id] ||= {};
      let decision=frozen.decision;
      const decisionFile=path.join(data,'roi','decisions',day,name);
      if(fs.existsSync(decisionFile)) {
        const record=JSON.parse(fs.readFileSync(decisionFile,'utf8'));
        const hash=require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(forecastDir,name))).digest('hex');
        if(record.forecast_sha256===hash && record.race_id===frozen.race_id &&
           Date.parse(record.saved_at)<Date.parse(record.snapshot.sales_close_at) &&
           Date.parse(record.snapshot.sales_close_at)<=Date.parse(frozen.cutoff))decision=record.decision;
      }
      const trials = {...frozen.comparison, probability_order:frozen.decision.probability_order,
        policy:decision.tickets.map(t=>t.key),...Object.fromEntries(Object.entries(decision.ev_thresholds||{}).map(([t,keys])=>['ev_'+t,keys]))};
      for (const [name,keys] of Object.entries(trials)) {
        if (!keys?.length && name!=='policy') continue;
        const chosen = keys.map(key=>({key,trio:key.split('-').map(Number)}));
        const row = Audit.settle({...p,chosen},result);
        if (row.status==='evaluated') (group[name] ||= []).push(row);
      }
    }
  }
  const models = Object.fromEntries(Object.entries(summaries).map(([id,strategies])=>[id,
    Object.fromEntries(Object.entries(strategies).map(([strategy,rows])=>{
      const stats=Audit.summarize(rows);
      return [strategy,{evaluated:stats.evaluated,purchased:stats.purchased,roi:stats.roi,
        stake:stats.stake,payout:stats.payout,net:stats.net,hit_rate:stats.hit_rate,avg_points:stats.avg_points,
        first_capture:stats.first_capture,pair_capture:stats.pair_capture,
        max_drawdown:stats.max_drawdown,trimmed:stats.trimmed}];
    }))]));
  return {schema:'tk-keirin-roi-prospective/v1',status,models,
    shadow:Object.fromEntries(Object.entries(shadowGroups).map(([id,group])=>[id,Shadow.report(group)]))};
}

if (require.main===module) {
  const data = path.join(__dirname,'../data');
  const report = monitor(data);
  save(path.join(data,'roi','prospective.json'),report);
  console.log(JSON.stringify(report.status));
}
module.exports = {monitor};