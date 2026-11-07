'use strict';

const VERSION = 'roi-fifth-ticket-v1';

function mixedTicket(lab, line, core) {
  const {riders, lineup} = lab.input;
  const lines = lineup.filter(group => group.length >= 2);
  if (riders.length !== 7 || lines.length !== 2) return {reason:'outside_scope'};
  const ridersByNo = new Map(riders.map(rider => [rider.no, rider]));
  const scores = lines.map(group => group.slice(0,2).map(no => ridersByNo.get(no)?.score));
  if (!scores.flat().every(Number.isFinite)) return {reason:'missing_score'};
  const [main, other] = lines.slice().sort((a,b) =>
    b.slice(0,2).reduce((sum,no) => sum + ridersByNo.get(no).score,0) -
    a.slice(0,2).reduce((sum,no) => sum + ridersByNo.get(no).score,0) ||
    a.join('-').localeCompare(b.join('-')));
  const [leader, marker] = main;
  const rival = ridersByNo.get(other[0]);
  if (!['逃','両'].includes(rival.style) || rival.score < ridersByNo.get(leader).score - 2) {
    return {reason:'rival_below_gate'};
  }
  if (!core.some(t => [leader,marker].every(no => t.trio.slice(0,2).includes(no)))) {
    return {reason:'lab_core_differs'};
  }
  const ticket = [marker,rival.no,leader].join('-');
  if (core.some(t => t.key === ticket)) return {reason:'already_in_core'};
  const out = line.out;
  for (const h of [out.main, ...(out.alternatives || [])]) {
    if (!h?.audit?.passed || h.audit.physical?.passed !== true || h.scenes?.length !== 6 ||
        !Number.isFinite(h.score) || out.main.score - h.score > .70 ||
        h.finish?.pair?.join('-') !== marker+'-'+rival.no ||
        !h.finish.thirds?.some(third => third.no === leader)) continue;
    const back = h.scenes[3].positions?.[rival.no];
    const corner = h.scenes[4].positions?.[leader];
    const inReach = p => Number.isInteger(p?.ordinal) && p.ordinal >= 0 && p.ordinal <= 3 &&
      ['inner','outside','inside'].includes(p.band);
    if (!inReach(back) || !inReach(corner) || h.scenes[4].connected?.[leader] !== true) continue;
    return {ticket,reason:'supported',evidence:{hypothesis:h.id,back_position:back.ordinal+1,
      leader_corner_position:corner.ordinal+1}};
  }
  return {reason:'no_supported_path'};
}

function build(lab, line) {
  const core = lab.chosen.slice(0,4);
  const main = core.length === 4 ? lab.chosen.slice(4).find(t => t.group === 'main') : null;
  return {version:VERSION,full:lab.chosen.map(t => t.key),core:core.map(t => t.key),
    main:main?.key || null,mixed:core.length === 4 ? mixedTicket(lab,line,core) : {reason:'insufficient_core'}};
}

module.exports = {build};
