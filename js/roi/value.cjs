'use strict';

const thresholds = [1.10,1.20,1.30];

function optimize({raceId, candidates, probabilities, calibration, snapshot, asOf, cutoff, cars, threshold=1.20}) {
  if (calibration?.eligible !== true || !probabilities) return {decision:'pass',reason:'calibration',tickets:[]};
  const at = Date.parse(asOf), limit = Date.parse(cutoff);
  const captured = Date.parse(snapshot?.captured_at), source = Date.parse(snapshot?.published_at);
  const close = Date.parse(snapshot?.sales_close_at);
  if (!snapshot || snapshot.race_id!==raceId || snapshot.market!=='trifecta' || snapshot.state!=='live' ||
      typeof snapshot.source_url!=='string' || !snapshot.source_url.startsWith('https://') ||
      !(source<=captured && captured<=at && at<close && close<=limit && at-source<=5*60*1000)) {
    return {decision:'pass',reason:'odds',tickets:[]};
  }
  if (!thresholds.includes(threshold)) throw Error('Unknown EV threshold');
  // The validation gate provides a precomputed lower probability factor;
  // skip value selection when a conservative bound is absent.
  const group = calibration.readiness?.groups?.[cars];
  const lower = group ? (group.qualified ? 1 : null) : calibration.lower_factor;
  if (!Number.isFinite(lower) || lower<=0 || lower>1) return {decision:'pass',reason:'uncertainty',tickets:[]};
  const pool = candidates.flatMap(candidate=>{
    const p=probabilities.get(candidate.key), odds=snapshot.odds?.[candidate.key];
    if (!candidate.evidence?.length || !Number.isFinite(p) || p<=0 || p>1 || !Number.isFinite(odds) || odds<1) return [];
    const factor=group ? group.bins.find(b=>p>=b.min&&p<b.max)?.lower_factor : lower;
    if (!(factor>0&&factor<=1)) return [];
    const ev = p*odds, conservative = ev*factor*.90;
    return conservative>=threshold ? [{...candidate,probability:p,odds,ev,conservative}] : [];
  }).sort((a,b)=>b.conservative-a.conservative || b.probability-a.probability || a.key.localeCompare(b.key));
  const tickets = [], pairs = new Map(), used = new Set();
  for (const item of pool) {
    const pair=item.trio.slice(0,2).join('-');
    if ((pairs.get(pair)||0)>=3 || used.has(item.key)) continue;
    used.add(item.key);
    pairs.set(pair,(pairs.get(pair)||0)+1);
    tickets.push(item);
    if (tickets.length===10) break;
  }
  return {decision:tickets.length?'buy':'pass',reason:tickets.length?'threshold':'no_edge',tickets};
}

module.exports = {thresholds,optimize};