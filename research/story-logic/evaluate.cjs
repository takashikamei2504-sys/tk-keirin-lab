'use strict';
// Independent research evaluator. Inputs must be synthetic or authorized.
function assertRace(race) {
  if (!race || ![7, 9].includes(race.fieldSize)) throw Error('invalid field size');
  const ids = race.lines.flat();
  if (ids.length !== race.fieldSize || new Set(ids).size !== ids.length ||
      ids.some(id => !Number.isInteger(id) || id < 1 || id > race.fieldSize))
    throw Error('invalid rider membership');
  const start = Date.parse(race.startAt);
  if (!Number.isFinite(start)) throw Error('invalid race start');
  for (const e of race.evidence || []) {
    const t = Date.parse(e.observedAt);
    if (!Number.isFinite(t) || t >= start) throw Error('post-start or undated evidence');
  }
  return new Set(ids);
}
function validateForecast(race, forecast) {
  const ids = assertRace(race);
  if (!ids.has(forecast.favored)) throw Error('invalid favored rider');
  if (forecast.lead != null && !race.lines.some(line => line[0] === forecast.lead))
    throw Error('invalid lead rider');
  for (const event of forecast.events || []) {
    if (!ids.has(event.actor) || !Number.isInteger(event.phase) ||
        event.phase < 1 || event.phase > 6) throw Error('invalid event');
  }
  const keys = new Set();
  for (const ticket of forecast.tickets || []) {
    if (ticket.length !== 3 || new Set(ticket).size !== 3 || ticket.some(id => !ids.has(id)))
      throw Error('invalid trifecta');
    const key = ticket.join('-');
    if (keys.has(key)) throw Error('duplicate trifecta');
    keys.add(key);
  }
  return keys;
}
function compare(race, reference, candidate) {
  const a = validateForecast(race, reference), b = validateForecast(race, candidate);
  const intersection = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return {
    favoredAgreement: reference.favored === candidate.favored,
    leadAgreement: reference.lead == null || candidate.lead == null ? null : reference.lead === candidate.lead,
    ticketJaccard: union ? intersection / union : null,
    commonTickets: intersection,
    referenceTickets: a.size,
    candidateTickets: b.size
  };
}
module.exports = {assertRace, validateForecast, compare};
