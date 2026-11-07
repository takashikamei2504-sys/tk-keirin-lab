'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const Engine = require('./engine.cjs');
const Calibration = require('./calibration.cjs');
const Value = require('./value.cjs');

function build(out, race, calibration, snapshot, asOf, cutoff) {
  const current = calibration?.hypothesis_model === out.model.model_id ? calibration : null;
  const ids = race.riders.map(r=>r.no);
  const probabilities = current?.beta ?
    Calibration.predict(Calibration.design(ids,out.scores),current.beta) : null;
  const candidates = out.chosen;
  const value = Value.optimize({raceId:race.date+':'+race.venue+':'+race.race_no,
    candidates,probabilities,calibration:current,snapshot,asOf,cutoff});
  const probabilityOrder = probabilities ? [...out.scores].sort(([a],[b])=>
    probabilities.get(b)-probabilities.get(a) || a.localeCompare(b)).slice(0,10).map(([key])=>key) : [];
  const variants = Object.fromEntries(Value.thresholds.map(threshold=>[threshold,
    Value.optimize({raceId:race.date+':'+race.venue+':'+race.race_no,candidates,probabilities,
      calibration:current,snapshot,asOf,cutoff,threshold}).tickets.map(t=>t.key)]));
  return {status:value.decision,reason:value.reason,tickets:value.tickets,
    probability_order:probabilityOrder,ev_thresholds:variants};
}

function model(calibration) {
  const version = 'roi-policy-v1.0.0';
  const hash = crypto.createHash('sha256').update(Engine.model.code_hash);
  for (const file of ['policy.cjs','calibration.cjs','value.cjs']) {
    hash.update(fs.readFileSync(path.join(__dirname,file)));
  }
  const code_hash = hash.digest('hex');
  const configuration_hash = crypto.createHash('sha256').update(JSON.stringify(calibration || null)).digest('hex');
  return {version,model_id:version+'@'+code_hash.slice(0,12)+'-'+configuration_hash.slice(0,12),
    code_hash,configuration_hash,hypothesis_model:Engine.model.model_id};
}

module.exports = {build, model};
