'use strict';
/* Materialize a compact report from immutable, pre-race ROI coverage candidates. */
const fs = require('node:fs');
const path = require('node:path');
const Gate = require('../js/coverage-gate/logic.js');
const root = path.resolve(__dirname, '..');
const data = path.join(root, 'data');
const read = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
const dates = dir => fs.existsSync(dir) ?
  fs.readdirSync(dir).filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort() : [];
const sameIdentity = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const POLICY_START = '2026-11-13';
const POLICY_VERSION = 'COVERAGE-GATE-v1/2026-11-12';
function build(dataRoot = data) {
  const resultsRoot = path.join(dataRoot,'lab_history');
  const forecastsRoot = path.join(dataRoot,'roi','forecasts');
  const routedRoot = path.join(dataRoot,'routed_history');
  const races = [], errors = [], models = {};
  for (const date of dates(forecastsRoot)) {
    const dir = path.join(forecastsRoot,date);
    const index = read(path.join(dir,'index.json'));
    if (!index || !Array.isArray(index.rows) || !index.model) {
      errors.push({date,reason:'index_missing'});continue;
    }
    const results = read(path.join(resultsRoot,date,'results.json'));
    const outcomes = new Map((results?.results || []).map(row => [row.race_id,row]));
    const route = read(path.join(routedRoot,date,'coverage.json'));
    const metadata = new Map((route?.races || []).map(row => [row.race_id,row]));
    for (const entry of index.rows.filter(row => row.model === index.model)) {
      if (!/^[a-f0-9]{64}\.json$/.test(entry.file || '')) {
        errors.push({race_id:entry.race_id,reason:'filename_invalid'});continue;
      }
      const frozen = read(path.join(dir,entry.file));
      if (!frozen || frozen.race_id !== entry.race_id ||
          frozen.model?.model_id !== entry.model ||
          frozen.saved_at !== entry.saved_at || frozen.cutoff !== entry.cutoff ||
          !sameIdentity(frozen.comparison?.coverage,entry.candidates) ||
          !sameIdentity(frozen.race,entry.race)) {
        errors.push({race_id:entry.race_id,reason:'frozen_mismatch'});continue;
      }
      const outcome = outcomes.get(entry.race_id);
      const matched = !outcome || sameIdentity(frozen.identity,outcome.identity);
      const routeMeta = metadata.get(entry.race_id);
      const meta = {...routeMeta,cars:frozen.identity?.length};
      const row = Gate.makeRace(entry,matched ? outcome : {race_id:entry.race_id},meta);
      if (!row) {errors.push({race_id:entry.race_id,reason:'invalid_frozen_forecast'});continue;}
      if (!matched) {row.status='unverified';row.stake=0;row.payout=0;row.hit=false;}
      row.model=entry.model;
      races.push(row);
      models[date]=index.model;
    }
  }
  races.sort((a,b)=>a.date.localeCompare(b.date)||a.cutoff.localeCompare(b.cutoff)||a.race_id.localeCompare(b.race_id));
  const evaluated = races.filter(x=>x.status==='evaluated');
  const exploratory = races.filter(x=>x.date<POLICY_START);
  const prospective = races.filter(x=>x.date>=POLICY_START);
  const clean = r=>Object.fromEntries([
    'race_id','date','venue','number','start','model','cars','grade','heads','pairs','tickets',
    'status','points','stake','payout','hit','saved_at','cutoff'
  ].map(k=>[k,r[k]]));
  return {
    schema:'tk-coverage-gate-validation/v1',policy:{version:POLICY_VERSION,start:POLICY_START,rules:Gate.FIXED,
      notice:'2026-11-12以前の選別ルール探索に使用したデータと、翌日からのルール固定実績は分離する'},
    source:'ROI発走前保存ファイルとLABの結果履歴を、レースID・保存時刻・発走時刻・選手IDで照合',
    models,summary:{
      all:Gate.analyze(races,Gate.FIXED),
      exploratory:Gate.analyze(exploratory,Gate.FIXED),
      prospective:Gate.analyze(prospective,Gate.FIXED),
      by_date:Gate.daily(races,Gate.FIXED),
      by_grade:Object.fromEntries([...new Set(evaluated.map(r=>r.grade))].sort().map(grade=>[grade,Gate.analyze(evaluated.filter(r=>r.grade===grade),Gate.FIXED)])),
      by_cars:Object.fromEntries([7,9].map(cars=>[cars,Gate.analyze(evaluated.filter(r=>r.cars===cars),Gate.FIXED)]))
    },races:races.map(clean),errors
  };
}
function save(file, value) {
  const content=JSON.stringify(value)+'\n';
  if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')===content) return false;
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file+'.tmp',content);fs.renameSync(file+'.tmp',file);return true;
}
if (require.main===module) {
  const report=build(process.argv[2]||data);
  const output=process.argv[3]||path.join(data,'coverage_gate','evaluation.json');
  console.log(JSON.stringify({updated:save(output,report),saved:report.races.length,errors:report.errors.length,
    total:report.summary.all,prospective:report.summary.prospective}));
}
module.exports={build,save,POLICY_START,POLICY_VERSION};
