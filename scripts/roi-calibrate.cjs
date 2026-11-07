'use strict';

const fs = require('node:fs');
const Readiness = require('../js/roi/readiness.cjs');
const path = require('node:path');
const Audit = require('../js/roi/audit.cjs');
const Engine = require('../js/roi/engine.cjs');
const Calibration = require('../js/roi/calibration.cjs');
const {readHistory,save} = require('./roi-audit.cjs');
const {pairs,holdout} = require('./roi-research.cjs');

function calibrate(data, asOf = Date.now()) {
  const history = readHistory(data);
  const day = new Date(asOf+9*3600000).toISOString().slice(0,10);
  const end = Date.parse(day+'T00:00:00+09:00');
  const boundary = Math.max(Date.parse(holdout+'T00:00:00+09:00'),end-7*86400000);
  const rows = [];
  for (const {lab,out} of pairs(history)) {
    const result = history.results.get(lab.race_id);
    const settled = Audit.settle(lab,result);
    if (settled.status!=='evaluated' || settled.void || result.withdrawn_cars?.length || result.refund_keys?.length) continue;
    const start = Date.parse(lab.cutoff);
    if (start>=end || !(Date.parse(result.collected_at)<end)) continue;
    rows.push({start,result_at:Date.parse(result.collected_at),winners:result.combos.map(x=>x.key),
      branches:Calibration.design(lab.input.riders.map(r=>r.no),out.scores)});
  }
  const validationRows=[];
  const dir=path.join(data,'roi','forecasts');
  for(const date of fs.existsSync(dir)?fs.readdirSync(dir).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)):[]) {
    for(const file of fs.readdirSync(path.join(dir,date)).filter(f=>/^[a-f0-9]{64}\.json$/.test(f))) {
      const r=JSON.parse(fs.readFileSync(path.join(dir,date,file),'utf8'));
      const v=r.probability_validation,result=history.results.get(r.race_id);
      if(!v || v.hypothesis_model!==Engine.model.model_id || !result || !(Date.parse(result.collected_at)<end))continue;
      const source=history.lab.find(p=>p.race_id===r.race_id&&p.saved_at===r.evidence.lab.saved_at&&p.input_sha256===r.evidence.lab.hash);
      if(!source)continue;
      const settled=Audit.settle(source,result);
      if(settled.status!=='evaluated'||settled.void||result.withdrawn_cars?.length||result.refund_keys?.length)continue;
      validationRows.push({...v,race_id:r.race_id,saved_at:r.saved_at,cutoff:r.cutoff,winners:result.combos.map(c=>c.key)});
    }
  }
  const fit=Calibration.train(rows,boundary),readiness=Readiness.review(validationRows);
  const eligible=fit.research_qualified&&readiness.eligible;
  return {schema:'tk-keirin-roi-calibration/v2',hypothesis_model:Engine.model.model_id,
    trained_through:new Date(end).toISOString(),holdout_from:new Date(boundary+9*3600000).toISOString().slice(0,10),
    holdout_through:new Date(end-1+9*3600000).toISOString().slice(0,10),...fit,
    readiness,eligible,stage:eligible?'eligible':fit.stage};
}

if (require.main === module) {
  const data = path.join(__dirname,'../data');
  const result = calibrate(data);
  save(path.join(data,'roi','calibration.json'),result);
  const {reliability,...holdout} = result.holdout || {};
  console.log(JSON.stringify({training_races:result.training_races,beta:result.beta,holdout,
    uniform:{log_loss:result.uniform.log_loss,brier:result.uniform.brier},stage:result.stage}));
}
module.exports = {calibrate};