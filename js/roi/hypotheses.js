/* Generated from js/roi/engine.cjs; do not edit by hand. */
(function(root){'use strict';
const Provenance=typeof module!=='undefined'?require('../model-provenance.js'):root.ModelProvenance;
const model=typeof module!=='undefined'?require('./hypotheses-build.js'):root.ROIHypothesesBuild;
const unique = rows => [...new Set(rows)];
const phase = (s, i) => ({phase:s.phase, order:s.order, text:s.action ||
  s.events?.map(e => e.reason).filter(Boolean).slice(0,3).join('。') || '隊列を維持',
  ...(i === 3 ? {burden:s.burden || s.state?.burden || null} : {})});

function sameRace(lab, line) {
  if (!lab || !line || lab.race_id !== line.race_id ||
      Date.parse(lab.cutoff) !== Date.parse(line.cutoff)) return false;
  const formation = p => p.input.lineup.map(l => l.join('-')).sort().join('/');
  return JSON.stringify(lab.identity) === JSON.stringify(line.identity) && formation(lab) === formation(line);
}

function labPaths(lab) {
  const story = lab.story;
  const paths = [story?.main, ...(story?.alternatives || [])].filter(s => s?.scenes?.length === 6);
  const tickets = lab.chosen.flatMap((t, rank) => {
    const scenario = paths.find(s => s.id === t.story_id);
    if (!scenario || scenario.audit?.passed === false || !t.explanation) return [];
    return [{...t, path:scenario.id, reason:t.explanation, support:1 / (1 + rank / 4)}];
  });
  return {main:paths[0] && {title:paths[0].reading, axis:'主導権・仕掛けと直線の脚色', scenes:paths[0].scenes.map(phase)},
    paths:paths.map(s => ({id:s.id, scenes:s.scenes.map(phase)})), tickets};
}

function linePaths(line) {
  const {out} = line;
  const valid = h => h?.audit?.passed && h.audit.physical?.passed !== false && h.scenes?.length === 6;
  const hypotheses = [out.main, ...(out.alternatives || [])].filter(valid);
  const paths = hypotheses.map(h => ({id:String(h.id), scenes:h.scenes.map(phase)}));
  const byId = new Map(hypotheses.map(h => [h.id, h]));
  const tickets = line.chosen.flatMap((t, rank) =>
    [t.hypothesis, ...(t.supporting_hypotheses || [])].filter((id, i, a) => a.indexOf(id) === i && byId.has(id)).map(id => {
      const h = byId.get(id);
      return {...t, mode:t.variation?.mode || h.finish.mode, path:String(id), support:1/(1+rank/4)};
    }));
  // Retained six-phase alternatives can supply missing finish families.
  // The source engine independently ranks the first/second and admissible thirds.
  for (const h of hypotheses) {
    const gap = Math.max(0, out.main.score - h.score);
    if (!(gap <= .70)) continue;
    for (const [rank, third] of h.finish.thirds.entries()) {
      if (!third.reason || !Number.isInteger(third.no) || h.finish.pair.includes(third.no)) continue;
      const trio = [...h.finish.pair, third.no];
      tickets.push({key:trio.join('-'), trio, mode:h.finish.mode, path:String(h.id),
        support:.76 / (1 + 3*gap + rank/2), reason:h.finish.mode+'。'+third.reason});
    }
  }
  return {main:valid(out.main) && {title:out.main.finish.mode+'｜'+out.main.finish.pair.join('→'),
    axis:out.decision.label || out.decision.axis, reason:out.decision.selection_reason,
    scenes:out.main.scenes.map(phase)}, paths, tickets};
}

function family(mode) {
  if (/^(lead|先行|逃げ)/.test(mode || '')) return '先行押し切り';
  if (/^(sashi|番手差し|縦踏み|vertical)/.test(mode || '')) return '番手差し';
  if (/捲り|makuri|kamashi|outer|強襲/.test(mode || '')) return '別線の捲り・差し';
  return '切替・内進路など';
}

function select(candidates, limit) {
  const left = [...candidates];
  const chosen = [], usedPairs = new Map(), usedHeads = new Map();
  while (chosen.length < limit && left.length) {
    const priority = t => t.support - .14 * (usedPairs.get(t.trio.slice(0,2).join('-')) || 0) -
      .055 * (usedHeads.get(t.trio[0]) || 0);
    left.sort((a,b) => priority(b)-priority(a) || a.key.localeCompare(b.key));
    const next = left.shift();
    if (priority(next) < .23) break;
    chosen.push(next);
    const pair = next.trio.slice(0,2).join('-');
    usedPairs.set(pair, (usedPairs.get(pair) || 0) + 1);
    usedHeads.set(next.trio[0], (usedHeads.get(next.trio[0]) || 0) + 1);
  }
  return chosen;
}

function build(lab, line) {
  if (!sameRace(lab, line)) return null;
  const sources = {LAB:labPaths(lab), LINE:linePaths(line)};
  const map = new Map();
  for (const [source, data] of Object.entries(sources)) {
    for (const t of data.tickets) {
      if (!t.reason || !Number.isFinite(t.support)) continue;
      const row = map.get(t.key) || {key:t.key, trio:t.trio, support:0, evidence:[]};
      row.support = Math.max(row.support,t.support);
      const mode = t.mode || '';
      const group = family(mode);
      if (!row.evidence.some(e => e.source === source && e.path === t.path && e.family === group)) {
        row.evidence.push({source, path:t.path, family:group, reason:t.reason, support:t.support});
      }
      map.set(row.key,row);
    }
  }
  const candidates = [...map.values()].sort((a,b) => b.support-a.support || a.key.localeCompare(b.key));
  const chosen = select(candidates,10);
  const used = new Set(chosen.flatMap(t => t.evidence.map(e => e.source+'|'+e.path)));
  const stories = Object.fromEntries(Object.entries(sources).map(([name, data]) =>
    [name, {main:data.main || null, paths:data.paths.filter(p => used.has(name+'|'+p.id)).map(p => ({id:p.id,order:p.scenes.map(s=>s.order)}))}]));
  const evidence = {lab:{model:lab.model_id,saved_at:lab.saved_at,hash:lab.input_sha256 || lab.provenance?.input_sha256},
    line:{model:line.model_id,saved_at:line.saved_at,hash:line.out.provenance.input_sha256}};
  const input_sha256 = Provenance.sha256({race:lab.race_id,evidence,stories,candidates});
  const families = Object.fromEntries(unique(candidates.flatMap(t=>t.evidence.map(e=>e.family))).map(name =>
    [name, candidates.filter(t=>t.evidence.some(e=>e.family===name)).map(t=>t.key).slice(0,5)]));
  return {model,input_sha256,evidence,stories,families,chosen,
    scores:candidates.map(t=>[t.key,t.support]),
    comparison:{
      LAB:lab.chosen.slice(0,10).map(t=>t.key), LINE:line.chosen.slice(0,10).map(t=>t.key),
      rankOnly:candidates.slice(0,10).map(t=>t.key), coverage:chosen.map(t=>t.key)
    }};
}

const api={build,model,sameRace,select};if(typeof module!=='undefined')module.exports=api;root.ROIHypotheses=api;
})(typeof globalThis!=='undefined'?globalThis:this);
