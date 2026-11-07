'use strict';

const Audit = require('../results-audit.js');

const ratio = (a, b) => b ? a / b : null;
const pair = trio => trio.slice(0, 2).join('-');

function latest(records, key = row => row.race_id) {
  const map = new Map();
  for (const row of records) {
    const id = key(row);
    const old = map.get(id);
    if (!old || Date.parse(row.saved_at) > Date.parse(old.saved_at) ||
        (row.saved_at === old.saved_at && row.model_id < old.model_id)) map.set(id, row);
  }
  return [...map.values()];
}

function validForecast(p) {
  const cutoff = Audit.startAt(p.input);
  const saved = Date.parse(p.saved_at);
  const source = Date.parse(p.input.source?.generated_at);
  const ids = p.input.riders.map(r => r.no);
  return p.pre_race && p.input.source?.mode === 'live-public-feed' &&
    Number.isFinite(source) && source <= saved && saved < cutoff &&
    Date.parse(p.cutoff) === cutoff && p.race_id === Audit.raceKey(p.input) &&
    JSON.stringify(p.identity) === JSON.stringify(Audit.identity(p.input)) &&
    [7, 9].includes(ids.length) && new Set(ids).size === ids.length &&
    ids.every(n => Number.isInteger(n) && n >= 1 && n <= 9) &&
    !p.input.riders.some(r => /^L/.test(r.meta?.rank || '')) &&
    new Set(p.chosen.map(t => t.key)).size === p.chosen.length &&
    p.chosen.every(t => t.trio?.length === 3 && new Set(t.trio).size === 3 &&
      t.trio.every(n => ids.includes(n)) && t.key === t.trio.join('-'));
}

function settle(p, result, metadata = {}) {
  if (!result) return {status: 'pending'};
  const cutoff = Audit.startAt(p.input);
  if (result.race_id !== p.race_id || result.race.start !== p.input.start ||
      !(cutoff < Date.parse(result.source_updated_at) &&
        Date.parse(result.source_updated_at) <= Date.parse(result.collected_at))) return {status: 'identity_or_time'};
  const withdrawn = new Set(result.withdrawn_cars || []);
  const refunds = new Set(result.refund_keys || []);
  const kept = identity => identity.filter(([no]) => !withdrawn.has(no));
  if (JSON.stringify(kept(p.identity)) !== JSON.stringify(kept(result.identity))) return {status: 'identity_or_time'};
  if (!result.void && !result.combos?.length) return {status: 'missing_payout'};
  const ids = new Set(p.identity.map(([no]) => no));
  const payouts = new Map();
  for (const win of result.combos || []) {
    if (!Number.isInteger(win.payout) || win.payout <= 0) return {status: 'missing_payout'};
    if (win.trio?.length !== 3 || new Set(win.trio).size !== 3 || win.key !== win.trio.join('-') ||
        win.trio.some(n => !ids.has(n) || withdrawn.has(n)) || refunds.has(win.key) || payouts.has(win.key)) {
      return {status: 'invalid_payout'};
    }
    payouts.set(win.key, win.payout);
  }
  const valid = p.chosen.filter(t => !result.void && !refunds.has(t.key) && !t.trio.some(n => withdrawn.has(n)));
  const wins = valid.flatMap(t => payouts.has(t.key) ? [payouts.get(t.key)] : []);
  const ranks = p.input.riders.map(r => r.meta?.rank || '');
  const round = p.input.class || '';
  const lines = p.input.lineup;
  const main = p.mainLine || lines.find(l => l.includes(p.chosen[0]?.trio[0]));
  const finish = result.combos?.map(x => x.trio) || [];
  const settlement = [...new Set(finish.map(trio => trio.every(n => main?.includes(n)) ? '本線内' :
    lines.some(line => trio.every(n => line.includes(n))) ? '別線内' : '混合'))];
  const active = lines.filter(l => p.input.riders.find(r => r.no === l[0])?.style !== '追').length;
  return {
    status: 'evaluated', race_id: p.race_id, model_id: p.model_id, date: p.input.date, venue: p.input.venue,
    cutoff, cars: p.identity.length, grade: ranks.some(r => /^S/.test(r)) || /^S級/.test(round) ? 'S級' :
      /チャレンジ/.test(round) || ranks.every(r => r === 'A3') ? 'チャレンジ' :
      ranks.some(r => /^A/.test(r)) || /^A級/.test(round) ? 'A級' : '級班不明',
    day: metadata.day || p.input.meeting_day || '日程不明', topology: active === 1 ? '先行一車' :
      ({2:'二分戦',3:'三分戦'})[lines.filter(l => l.length > 1).length] || '細切れ',
    length: Math.min(4, Math.max(...lines.map(l => l.length))), settlement: settlement.join('・') || '不成立',
    points: valid.length, refunded: p.chosen.length - valid.length, wins,
    first: finish.some(t => valid.some(c => c.trio[0] === t[0])),
    pair: finish.some(t => valid.some(c => pair(c.trio) === pair(t))),
    actualPayouts: [...payouts.values()], void: !!result.void
  };
}

const payoutBand = yen => yen < 1000 ? '10倍未満' : yen < 5000 ? '10〜50倍未満' :
  yen < 10000 ? '50〜100倍未満' : yen < 30000 ? '100〜300倍未満' : '300倍以上';

function summarize(rows) {
  const ordered = [...rows].sort((a, b) => a.cutoff - b.cutoff || a.race_id.localeCompare(b.race_id));
  let stake = 0, payout = 0, peak = 0, maxDrawdown = 0, streak = 0, maxStreak = 0;
  const wins = [], bands = {};
  let biggestRace = {payout: 0, points: 0};
  for (const row of ordered) {
    stake += row.points * 100;
    const returned = row.wins.reduce((sum, yen) => sum + yen, 0);
    payout += returned;
    wins.push(...row.wins);
    if (Math.max(0, ...row.wins) > (biggestRace.top || 0)) {
      biggestRace = {payout: returned, points: row.points, top: Math.max(...row.wins)};
    }
    if (row.points) streak = returned ? 0 : streak + 1;
    maxStreak = Math.max(maxStreak, streak);
    peak = Math.max(peak, payout - stake);
    maxDrawdown = Math.max(maxDrawdown, peak - (payout - stake));
    const group = [...new Set(row.actualPayouts.map(payoutBand))];
    const band = group.length === 1 ? group[0] : group.length ? '複数帯（同着）' : '不成立';
    const b = bands[band] ||= {races: 0, hits: 0, stake: 0, payout: 0};
    b.races++;
    b.hits += Number(returned > 0);
    b.stake += row.points * 100;
    b.payout += returned;
  }
  for (const b of Object.values(bands)) b.roi = ratio(b.payout, b.stake);
  const purchased = rows.filter(r => r.points).length;
  const hits = rows.filter(r => r.wins.length).length;
  const eligible = rows.filter(r => !r.void).length;
  wins.sort((a, b) => b - a);
  return {evaluated: rows.length, purchased, tickets: stake / 100, avg_points: ratio(stake / 100, purchased),
    refunded_tickets: rows.reduce((n, r) => n + r.refunded, 0), hits, winning_tickets: wins.length,
    hit_rate: ratio(hits, purchased), first_capture: ratio(rows.filter(r => r.first).length, eligible),
    pair_capture: ratio(rows.filter(r => r.pair).length, eligible),
    first_misses: eligible - rows.filter(r => r.first).length,
    stake, payout, net: payout - stake, roi: ratio(payout, stake), max_drawdown: maxDrawdown,
    max_losing_streak: maxStreak, current_losing_streak: streak, top_payouts: wins.slice(0, 5),
    trimmed: Object.fromEntries([1, 3, 5].map(n => [n, ratio(payout - wins.slice(0, n).reduce((a,b) => a + b, 0), stake)])),
    without_top_race: ratio(payout - biggestRace.payout, stake - biggestRace.points * 100),
    payout_bands: bands};
}

function group(rows, field) {
  const groups = new Map();
  for (const row of rows) {
    const key = row[field];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries([...groups].map(([key, rs]) => [key, summarize(rs)]));
}

function compare(a, b) {
  const right = new Map(b.map(r => [r.race_id, r]));
  const left = a.filter(r => right.has(r.race_id));
  const paired = left.map(r => right.get(r.race_id));
  const better = [], worse = [];
  for (const [i, base] of left.entries()) {
    const newRow = paired[i];
    const delta = newRow.wins.reduce((x,y) => x+y, 0) - base.wins.reduce((x,y) => x+y, 0) -
      100 * (newRow.points - base.points);
    if (delta) (delta > 0 ? better : worse).push({race_id: base.race_id, delta});
  }
  return {races: left.length, base: summarize(left), candidate: summarize(paired),
    better: better.sort((a,b) => b.delta-a.delta).slice(0, 5),
    worse: worse.sort((a,b) => a.delta-b.delta).slice(0, 5)};
}

module.exports = {validForecast, latest, settle, summarize, group, compare};
