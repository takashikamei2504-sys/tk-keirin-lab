'use strict';

const Audit = require('../js/roi/audit.cjs');

function add(group, shadow, prediction, result) {
  const settle = keys => Audit.settle({...prediction,chosen:keys.map(key =>
    ({key,trio:key.split('-').map(Number)}))},result);
  const core = settle(shadow.core);
  const full = settle(shadow.full);
  if (core.status !== 'evaluated' || core.void) return;
  group.all.push({full,core});
  const main = shadow.main ? settle([shadow.main]) : null;
  const mixed = shadow.mixed.ticket ? settle([shadow.mixed.ticket]) : null;
  if (main?.points === 1) group.main.push(main);
  if (mixed?.points === 1) group.mixed.push(mixed);
  if (core.points !== 4 || main?.points !== 1) return;
  const pair = other => ({core,main,mixed:other,
    coreMain:{...core,points:5,wins:[...core.wins,...main.wins]},
    coreMixed:{...core,points:5,wins:[...core.wins,...other.wins]}});
  if (mixed?.points === 1) group.paired.push(pair(mixed));
  const reference = shadow.mixed.reference ? settle([shadow.mixed.reference]) : null;
  if (reference?.points === 1) group.reference.push(pair(reference));
}

const create = () => ({all:[],main:[],mixed:[],paired:[],reference:[],gates:{},pending:0});

function compact(rows) {
  const s = Audit.summarize(rows);
  return {races:s.evaluated, hits:s.hits, stake:s.stake, payout:s.payout, net:s.net, roi:s.roi,
    max_drawdown:s.max_drawdown, trimmed:{1:s.trimmed[1],5:s.trimmed[5]}};
}

function report(group) {
  const paired = rows => Object.fromEntries(['core','coreMain','coreMixed','main','mixed'].map(key =>
    [key,compact(rows.map(row=>row[key]))]));
  function breakdown(select) {
    const map = new Map();
    for (const row of group.paired) {
      const key = select(row.core);
      if (!map.has(key)) map.set(key,[]);
      map.get(key).push(row);
    }
    return Object.fromEntries([...map].sort(([a],[b])=>a.localeCompare(b)).map(([key,rows])=>[key,paired(rows)]));
  }
  return {pending:group.pending,gates:group.gates,all:{full:compact(group.all.map(r=>r.full)),
    core:compact(group.all.map(r=>r.core)),main:compact(group.main),mixed:compact(group.mixed)},
    paired:paired(group.paired),reference_paired:paired(group.reference),by_grade:breakdown(r=>r.grade),by_month:breakdown(r=>r.date.slice(0,7))};
}

module.exports = {add,create,report};
