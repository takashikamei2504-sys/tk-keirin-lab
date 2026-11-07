'use strict';

const path = require('node:path');
const Audit = require('../js/roi/audit.cjs');
const Engine = require('../js/roi/engine.cjs');
const Calibration = require('../js/roi/calibration.cjs');
const {readHistory,save} = require('./roi-audit.cjs');
const {pairs,holdout} = require('./roi-research.cjs');

function calibrate(data) {
  const history = readHistory(data);
  const boundary = Date.parse(holdout+'T00:00:00+09:00');
  const end = Date.parse('2026-11-07T00:00:00+09:00');
  const rows = [];
  for (const {lab,out} of pairs(history)) {
    const result = history.results.get(lab.race_id);
    const settled = Audit.settle(lab,result);
    if (settled.status!=='evaluated' || settled.void || result.withdrawn_cars?.length || result.refund_keys?.length) continue;
    const start = Date.parse(lab.cutoff);
    if (start>=end) continue;
    rows.push({start,result_at:Date.parse(result.collected_at),winners:result.combos.map(x=>x.key),
      branches:Calibration.design(lab.input.riders.map(r=>r.no),out.scores)});
  }
  return {schema:'tk-keirin-roi-calibration/v1',hypothesis_model:Engine.model.model_id,
    holdout_from:holdout,holdout_through:'2026-11-06',...Calibration.train(rows,boundary)};
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
