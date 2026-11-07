'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Audit = require('../js/roi/audit.cjs');
const Engine = require('../js/roi/engine.cjs');
const {readHistory, save} = require('./roi-audit.cjs');
const LAB = require('../js/model-build.js');
const ROOT = path.join(__dirname, '..');
const holdout = '2026-11-06';

function pairs(history, minimumCutoff = -Infinity) {
  const index = new Map(Audit.latest(history.lab.filter(p=>p.model_id===LAB.model_id)).map(p=>[p.race_id,p]));
  return Audit.latest(history.line).flatMap(line=>{
    const lab = index.get(line.race_id);
    if (!Engine.sameRace(lab,line) || Date.parse(lab.cutoff)<=minimumCutoff) return [];
    const out = Engine.build(lab,line);
    return [{lab,line,out}];
  });
}

function research(data) {
  const history = readHistory(data);
  const metadata = JSON.parse(fs.readFileSync(path.join(data,'roi','meeting-days.json'),'utf8'));
  const sets = {development:{},holdout:{}};
  for (const {lab,line,out} of pairs(history)) {
    const result = history.results.get(lab.race_id);
    const byCar = keys => keys.map(key=>({key,trio:key.split('-').map(Number)}));
    const reference = Audit.settle(lab,result,{day:metadata[lab.input.date]?.[lab.input.venue]});
    if (reference.status !== 'evaluated') continue;
    const group = sets[lab.input.date < holdout ? 'development' : 'holdout'];
    const strategies = {lab:lab.chosen,line:line.chosen,
      line10:byCar(out.comparison.LINE),integrated_rank:byCar(out.comparison.rankOnly),integrated_coverage:out.chosen};
    for (const [name,chosen] of Object.entries(strategies)) {
      const row = Audit.settle({...lab,chosen},result,{day:reference.day});
      if (row.status === 'evaluated') (group[name] ||= []).push(row);
    }
  }
  const summarize = group=>Object.fromEntries(Object.entries(group).map(([name,rows])=>
    [name,{...Audit.summarize(rows),breakdown:Object.fromEntries(
      ['date','grade','cars','venue','day','topology','length','settlement'].map(field=>[field,Audit.group(rows,field)]))}]));
  return {schema:'tk-keirin-roi-research/v1',model:Engine.model,holdout_from:holdout,
    development:summarize(sets.development),holdout:summarize(sets.holdout),
    comparisons:Object.fromEntries(Object.entries(sets).map(([key,group])=>[key,
      group.lab ? Audit.compare(group.lab,group.integrated_coverage) : null]))};
}

function publicResearch(full) {
  const allowed = ['evaluated','purchased','tickets','hits','hit_rate','first_capture','pair_capture',
    'avg_points','stake','payout','net','roi','max_drawdown','trimmed','without_top_race','payout_bands'];
  const compact = row=>Object.fromEntries(allowed.map(k=>[k,row[k]]));
  const period = data=>Object.fromEntries(Object.entries(data).map(([name,row])=>[name,{...compact(row),
    breakdown:Object.fromEntries(Object.entries(row.breakdown).map(([field,groups])=>[field,
      Object.fromEntries(Object.entries(groups).map(([key,rs])=>[key,{races:rs.evaluated,roi:rs.roi,net:rs.net}]))]))}]));
  return {schema:full.schema,model:full.model,holdout_from:full.holdout_from,
    development:period(full.development),holdout:period(full.holdout)};
}

if (require.main === module) {
  const data = path.join(ROOT,'data');
  const report = research(data);
  save(path.join(data,'roi','research.json'),publicResearch(report));
  for (const period of ['development','holdout']) {
    console.log(period,Object.fromEntries(Object.entries(report[period]).map(([k,v])=>[k,[v.evaluated,v.roi,v.first_capture,v.pair_capture,v.avg_points,v.trimmed[1],v.net,v.max_drawdown]])));
  }
}
module.exports = {pairs,research,holdout};
