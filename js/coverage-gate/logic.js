/* TK KEIRIN LAB / COVERAGE GATE: frozen-prediction, outcome-only replay. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CoverageGate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FIXED = Object.freeze({cars: '7', maxHeads: 5});
  const iso = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN;
  const yen = value => Math.round(Number(value) || 0);
  const validKey = key => {
    if (typeof key !== 'string' || !/^[1-9]-[1-9]-[1-9]$/.test(key)) return false;
    const numbers = key.split('-').map(Number);
    return new Set(numbers).size === 3;
  };
  const sourceDate = input => String(input || '').slice(0, 10);
  function makeRace(record, result, meta) {
    const race = record && record.race;
    if (!record || !race || !record.race_id || !/^\d{4}-\d\d-\d\d$/.test(race.date || '') ||
        record.race_id !== [race.date, race.venue, race.number].join(':') ||
        !(iso(record.saved_at) < iso(record.cutoff)) ||
        !Array.isArray(record.candidates) || record.candidates.length > 10) return null;
    const keys = record.candidates;
    if (!keys.length || new Set(keys).size !== keys.length || !keys.every(validKey)) return null;
    const expectedCutoff = iso(race.date + 'T' + race.start + ':00+09:00');
    if (!Number.isFinite(expectedCutoff) || iso(record.cutoff) !== expectedCutoff) return null;
    const heads = new Set(keys.map(key => key.split('-')[0])).size;
    const pairs = new Set(keys.map(key => key.split('-').slice(0, 2).join('-'))).size;
    const metaCars = Number(meta && meta.cars);
    const resultCars = result && result.race && Array.isArray(result.race.riders) ? result.race.riders.length : null;
    const cars = resultCars || ([7, 9].includes(metaCars) ? metaCars : null);
    const grade = (meta && meta.category ? String(meta.category).split('_')[0] : '') || '不明';
    let status = 'pending', stake = 0, payout = 0, hit = false;
    let points = keys.length;
    if (result) {
      const sameRace = result.race_id === record.race_id && result.race &&
        result.race.start === race.start &&
        Array.isArray(result.combos) &&
        iso(result.source_updated_at) > iso(record.cutoff) &&
        iso(result.collected_at) >= iso(result.source_updated_at);
      if (!sameRace) status = 'unverified';
      else if (result.void) {
        status = 'void'; points = 0;
      } else if (result.combos.every(combo => combo && validKey(combo.key) &&
          Number.isInteger(combo.payout) && combo.payout > 0)) {
        const withdrawn = new Set(result.withdrawn_cars || []);
        const refund = new Set(result.refund_keys || []);
        const active = keys.filter(key => !refund.has(key) &&
          !key.split('-').some(no => withdrawn.has(Number(no))));
        points = active.length;
        stake = 100 * points;
        const matched = new Set(active);
        payout = result.combos.reduce((sum, combo) => sum +
          (matched.has(combo.key) ? yen(combo.payout) : 0), 0);
        hit = payout > 0;
        status = 'evaluated';
      } else status = 'unverified';
    }
    return {
      race_id: record.race_id, date: race.date, venue: race.venue,
      number: race.number, start: race.start, model: record.model,
      cars, grade, heads, pairs, tickets: keys, status, points,
      stake, payout, hit, saved_at: record.saved_at, cutoff: record.cutoff
    };
  }
  function gate(race, rules) {
    const reasons = [];
    if (rules.cars === '7' && race.cars !== 7)
      reasons.push(race.cars === null ? '車数を確認できない' : '9車立て');
    if (rules.cars === '9' && race.cars !== 9)
      reasons.push(race.cars === null ? '車数を確認できない' : '7車立て');
    if (Number.isFinite(rules.maxHeads) && race.heads > rules.maxHeads)
      reasons.push('1着候補が' + race.heads + '車');
    return {pass: reasons.length === 0, reasons};
  }
  function metrics(rows) {
    const ordered = rows.filter(r => r.status === 'evaluated' && r.points > 0)
      .slice().sort((a, b) => a.cutoff.localeCompare(b.cutoff) || a.race_id.localeCompare(b.race_id));
    let stake = 0, payout = 0, peak = 0, drawdown = 0;
    for (const row of ordered) {
      stake += row.stake;
      payout += row.payout;
      const net = payout - stake;
      peak = Math.max(peak, net);
      drawdown = Math.max(drawdown, peak - net);
    }
    const biggest = Math.max(0, ...ordered.map(r => r.payout));
    return {
      races: ordered.length, hits: ordered.filter(r => r.hit).length, stake, payout,
      net: payout - stake, roi: stake ? payout / stake : null,
      hitRate: ordered.length ? ordered.filter(r => r.hit).length / ordered.length : null,
      trimmed: stake ? (payout - biggest) / stake : null,
      maxDrawdown: drawdown, topPayout: biggest
    };
  }
  function analyze(races, rules) {
    const evaluated = races.filter(r => r.status === 'evaluated' && r.points > 0);
    const passing = evaluated.filter(r => gate(r, rules).pass);
    const skipped = evaluated.filter(r => !gate(r, rules).pass);
    const pending = races.filter(r => r.status === 'pending');
    return {
      all: metrics(evaluated), passing: metrics(passing), skipped: metrics(skipped),
      evaluated: evaluated.length, passedCount: passing.length,
      skippedCount: skipped.length, pendingCount: pending.length,
      excludedCount: races.filter(r => ['unverified', 'void'].includes(r.status)).length,
      savedCount: races.length,
      savedAgainst: races.filter(r => r.status === 'pending' && gate(r, rules).pass).length,
      savedSkipped: races.filter(r => r.status === 'pending' && !gate(r, rules).pass).length
    };
  }
  function daily(races, rules) {
    const map = new Map();
    for (const race of races) {
      if (!map.has(race.date)) map.set(race.date, []);
      map.get(race.date).push(race);
    }
    return [...map].sort(([a], [b]) => b.localeCompare(a))
      .map(([date, rows]) => ({date, ...analyze(rows, rules)}));
  }
  return {FIXED, validKey, makeRace, gate, metrics, analyze, daily};
});
