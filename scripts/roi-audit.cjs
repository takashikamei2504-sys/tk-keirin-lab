'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const History = require('./history-store.cjs');
const Legacy = require('../js/results-audit.js');
const Line = require('../js/line/evaluation.js');
const Audit = require('../js/roi/audit.cjs');
const LAB = require('../js/model-build.js');
const root = path.join(__dirname, '..');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const dateName = /^\d{4}-\d{2}-\d{2}$/;
const fields = ['date', 'grade', 'cars', 'venue', 'day', 'topology', 'length', 'settlement'];

function readHistory(data, {withResults = true, from = ''} = {}) {
  const labDir = path.join(data, 'lab_history');
  const lineDir = path.join(data, 'line_history');
  const results = new Map();
  const lab = [], line = [], exclusions = {lab: 0, line: 0};
  for (const date of History.dates(labDir).filter(d => d >= from)) {
    const history = History.load(labDir, date, {withResults});
    for (const result of history.results) results.set(result.race_id, result);
    for (const p of history.predictions) {
      if (Audit.validForecast(p)) lab.push({...p, model_id: Legacy.modelId(p)});
      else exclusions.lab++;
    }
  }
  for (const date of fs.readdirSync(lineDir).filter(n => dateName.test(n) && n >= from).sort()) {
    const directory = path.join(lineDir, date);
    for (const file of fs.readdirSync(directory).filter(n => /^[a-f0-9]{64}\.json$/.test(n)).sort()) {
      const record = read(path.join(directory, file));
      if (Line.evaluate(record).status !== 'pending' ||
          file !== crypto.createHash('sha256')
            .update(record.race_id+'|'+record.out.provenance.model.model_id).digest('hex')+'.json') {
        exclusions.line++;
        continue;
      }
      const {out} = record;
      line.push({race_id: record.race_id, saved_at: record.saved_at,
        cutoff: out.input.cutoff, pre_race: true, model_id: out.provenance.model.model_id,
        input: out.input.race, identity: Legacy.identity(out.input.race), chosen: out.tickets,
        mainLine: out.main.scenes[3]?.groups.find(g => g.id === out.main.scenes[3]?.control && g.lane === 0)?.members,
        out});
    }
  }
  return {lab, line, results, exclusions};
}

function report({lab, line, results, exclusions}, metadata = {}) {
  function account(list) {
    const statuses = {};
    const rows = [];
    for (const p of list) {
      const row = Audit.settle(p, results.get(p.race_id), {day: metadata[p.input.date]?.[p.input.venue]});
      statuses[row.status] = (statuses[row.status] || 0) + 1;
      if (row.status === 'evaluated') rows.push(row);
    }
    return {rows, data:{...Audit.summarize(rows), statuses,
      breakdown: Object.fromEntries(fields.map(field => [field, Audit.group(rows, field)]))}};
  }
  function source(list) {
    const byModel = new Map();
    for (const p of Audit.latest(list, p => p.race_id+'|'+p.model_id)) {
      if (!byModel.has(p.model_id)) byModel.set(p.model_id, []);
      byModel.get(p.model_id).push(p);
    }
    const latest = account(Audit.latest(list));
    return {latest, by_model: Object.fromEntries([...byModel].map(([model, ps]) => [model, account(ps).data]))};
  }
  const labReport = source(lab), lineReport = source(line);
  return {schema:'tk-keirin-roi-audit/v1', current_lab_model:LAB.model_id, exclusions,
    lab:{latest:labReport.latest.data, by_model:labReport.by_model},
    line:{latest:lineReport.latest.data, by_model:lineReport.by_model},
    comparison:Audit.compare(labReport.latest.rows, lineReport.latest.rows)};
}

// Public report contains only aggregates from the already public frozen histories.
function publicReport(full) {
  const compact = row => {
    const fields = ['evaluated','purchased','hits','hit_rate','stake','payout','net','roi',
      'avg_points','first_capture','pair_capture','max_drawdown'];
    return Object.fromEntries(fields.map(key => [key,row[key]]));
  };
  const aggregate = row => ({...row, top_payouts:undefined,
    breakdown:Object.fromEntries(Object.entries(row.breakdown).map(([name,groups]) =>
      [name,Object.fromEntries(Object.entries(groups).map(([key,values])=>[key,compact(values)]))]))});
  const source = model => ({latest:aggregate(model.latest),
    by_model:Object.fromEntries(Object.entries(model.by_model).map(([id,row])=>[id,aggregate(row)]))});
  return {...full,lab:source(full.lab),line:source(full.line),
    comparison:{races:full.comparison.races,base:compact(full.comparison.base),candidate:compact(full.comparison.candidate),
      base_trimmed:full.comparison.base.trimmed,candidate_trimmed:full.comparison.candidate.trimmed}};
}

function save(file, value) {
  const content = JSON.stringify(value) + '\n';
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return;
  fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(file + '.tmp', content);
  fs.renameSync(file + '.tmp', file);
}

function saveMeetingDays(feedDir, data) {
  const file = path.join(data, 'roi', 'meeting-days.json');
  const metadata = fs.existsSync(file) ? read(file) : {};
  for (const name of fs.readdirSync(feedDir).sort()) {
    if (!dateName.test(name.replace(/\.json$/, ''))) continue;
    const feed = read(path.join(feedDir, name));
    if (feed.date + '.json' !== name) continue;
    const venues = metadata[feed.date] ||= {};
    for (const [venue, info] of Object.entries(feed.venue_info || {})) {
      if (/^(初日|二日目|三日目|四日目|最終日)$/.test(info.meeting_day)) venues[venue] = info.meeting_day;
    }
  }
  save(file, metadata);
}

if (require.main === module) {
  const data = process.argv[2] || path.join(root, 'data');
  const metadata = path.join(data, 'roi', 'meeting-days.json');
  const result = report(readHistory(data), fs.existsSync(metadata) ? read(metadata) : {});
  save(process.argv[3] || path.join(data, 'roi', 'audit.json'), publicReport(result));
  for (const row of [result.lab.by_model[LAB.model_id], result.line.latest]) {
    console.log(JSON.stringify(Object.fromEntries(['evaluated','hits','stake','payout','roi','first_misses','trimmed'].map(k=>[k,row?.[k]]))));
  }
}

module.exports = {readHistory, report, publicReport, save, saveMeetingDays};
