'use strict';
// Relative hypothesis mass, NOT a calibrated probability of a race outcome.
function allocate(parentMass, candidates) {
  if (!Number.isFinite(parentMass) || parentMass < 0 || !Array.isArray(candidates)) {
    throw new Error('Expected finite nonnegative parent mass and candidates');
  }
  const unique = new Map();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.key !== 'string' || !candidate.key.trim() ||
        !Number.isFinite(candidate.weight) || candidate.weight < 0 ||
        !['allowed', 'blocked', 'unknown'].includes(candidate.feasibility)) {
      throw new Error('Invalid branch candidate');
    }
    const prior = unique.get(candidate.key);
    if (prior && (prior.weight !== candidate.weight || prior.feasibility !== candidate.feasibility)) {
      throw new Error(`Conflicting duplicate branch: ${candidate.key}`);
    }
    // Same semantic action, same weight: count once, even if discovered twice.
    if (!prior) unique.set(candidate.key, candidate);
  }
  const active = [...unique.values()].filter(x => x.feasibility !== 'blocked' && x.weight > 0);
  if (!active.length) return { branches: [], unresolvedMass: parentMass, status: 'dead_end' };
  // Scale before summing to avoid overflow with large finite weights.
  const scale = Math.max(...active.map(x => x.weight));
  const total = active.reduce((sum, x) => sum + x.weight / scale, 0);
  return {
    branches: active.map(x => ({ key: x.key, mass: parentMass * ((x.weight / scale) / total),
      feasibility: x.feasibility })),
    unresolvedMass: 0,
    status: 'allocated'
  };
}
module.exports = { allocate };
