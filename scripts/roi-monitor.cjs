'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Audit = require('../js/roi/audit.cjs');
const History = require('./history-store.cjs');
const {save} = require('./roi-audit.cjs');

function monitor(data) {
  const dir = path.join(data,'roi','forecasts');
  const lab = path.join(data,'lab_history');
  const summaries = {};
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
      const result = results.get(frozen.race_id);
      if (!result) { status.pending++; continue; }
      const p = baseline.get(frozen.race_id+'|'+frozen.evidence.lab.model);
      if (!p || p.saved_at!==frozen.evidence.lab.saved_at ||
          p.input_sha256!==frozen.evidence.lab.hash || p.cutoff!==frozen.cutoff) { status.unmatched++; continue; }
      const group = summaries[frozen.model.model_id] ||= {};
      const trials = {...frozen.comparison, probability_order:frozen.decision.probability_order,
        policy:frozen.decision.tickets.map(t=>t.key)};
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
  return {schema:'tk-keirin-roi-prospective/v1',status,models};
}

if (require.main===module) {
  const data = path.join(__dirname,'../data');
  const report = monitor(data);
  save(path.join(data,'roi','prospective.json'),report);
  console.log(JSON.stringify(report.status));
}
module.exports = {monitor};
