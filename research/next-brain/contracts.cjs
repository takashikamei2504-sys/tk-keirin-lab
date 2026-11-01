'use strict';
// Preparation contract only; the published engine does not import this module.
const PHASES = ['formation', 'bell', 'final_home', 'final_back', 'straight'];
function assertState(state, riderIds) {
  if (!Array.isArray(riderIds) || ![7, 9].includes(riderIds.length) ||
      new Set(riderIds).size !== riderIds.length ||
      riderIds.some(id => !Number.isInteger(id) || id < 1 || id > 9)) {
    throw new Error('Expected 7 or 9 distinct rider numbers');
  }
  if (!state || !PHASES.includes(state.phase)) throw new Error('Unknown phase');
  if (!Array.isArray(state.order) || state.order.length !== riderIds.length ||
      new Set(state.order).size !== riderIds.length ||
      state.order.some(id => !riderIds.includes(id))) throw new Error('Order must be a permutation');
  for (const field of ['remainingDistanceM', 'speedMps', 'windMps']) {
    const value = state[field];
    if (value !== null && (!Number.isFinite(value) || (field !== 'windMps' && value < 0))) {
      throw new Error(`${field} must be a finite value or explicit null`);
    }
  }
  if (!state.energy || Object.keys(state.energy).length !== riderIds.length ||
      riderIds.some(id => !Number.isFinite(state.energy[id]) || state.energy[id] < 0 || state.energy[id] > 1)) {
    throw new Error('Expected a hypothetical energy value in [0,1] for every rider');
  }
  if (!['unknown', 'rule_assumption', 'measured'].includes(state.kinematicsBasis)) {
    throw new Error('Expected kinematics provenance');
  }
  if (state.kinematicsBasis === 'unknown' &&
      (state.remainingDistanceM !== null || state.speedMps !== null)) {
    throw new Error('Unknown kinematics cannot contain invented measurements');
  }
  return state;
}
// A scope is mandatory: an intention for one race is not a habitual trait.
function eligibleMemory(memory, cutoff, raceId) {
  const limit = Date.parse(cutoff);
  if (!Number.isFinite(limit) || !memory ||
      !['habitual_observation', 'race_intention', 'current_form'].includes(memory.kind) ||
      !memory.riderId || !memory.bodyVerified || !/^https:\/\//.test(memory.url || '')) return false;
  const published = Date.parse(memory.publishedAt), collected = Date.parse(memory.collectedAt);
  if (!Number.isFinite(published) || !Number.isFinite(collected) ||
      published > collected || published >= limit || collected >= limit) return false;
  if (memory.kind === 'habitual_observation') return memory.scope === 'rider';
  if (memory.kind === 'race_intention') return memory.scope === 'race' && memory.raceId === raceId;
  const expires = Date.parse(memory.validUntil);
  return memory.scope === 'period' && Number.isFinite(expires) && limit <= expires;
}
module.exports = { PHASES, assertState, eligibleMemory };
