'use strict';
const assert = require('node:assert/strict');
const { allocate } = require('../research/next-brain/weights.cjs');
const { assertState, eligibleMemory } = require('../research/next-brain/contracts.cjs');
const fixtures = require('../research/next-brain/fixtures.json');
const near = (a,b) => assert.ok(Math.abs(a-b) < 1e-12, `${a} != ${b}`);
const choices = [
  {key:'resist:1',weight:3,feasibility:'allowed'},
  {key:'yield:1',weight:1,feasibility:'unknown'},
  {key:'teleport:1',weight:1000,feasibility:'blocked'}
];
const before = JSON.stringify(choices);
const allocated = allocate(0.8, choices);
near(allocated.branches.reduce((s,x)=>s+x.mass,0), 0.8);
near(allocated.branches[0].mass, 0.6);
assert.equal(allocated.branches[1].feasibility,'unknown');
assert.equal(allocated.branches.length,2);
assert.deepEqual(allocate(0.8,[...choices, {...choices[0]}]), allocated);
assert.equal(JSON.stringify(choices), before);
assert.throws(()=>allocate(1,[choices[0],{...choices[0],weight:2}]), /Conflicting/);
assert.throws(()=>allocate(1,[{...choices[0],weight:NaN}]));
assert.throws(()=>allocate(1,[{...choices[0],weight:-1}]));
assert.throws(()=>allocate(Infinity,choices));
assert.deepEqual(allocate(0.4,[choices[2]]),{branches:[],unresolvedMass:0.4,status:'dead_end'});
assert.equal(allocate(1,[{...choices[0],weight:0}]).unresolvedMass,1);
// Splitting a branch again must conserve the root mass, including dead ends.
const children = allocated.branches.map(x=>allocate(x.mass, choices));
near(children.flatMap(x=>x.branches).reduce((s,x)=>s+x.mass,0),0.8);
near(allocate(1,choices.slice(0,2).map(x=>({...x,weight:x.weight*1e300})))
  .branches.reduce((s,x)=>s+x.mass,0),1);
for (const fixture of fixtures.cases) {
  assertState(fixture.state, fixture.riderIds);
  assert.deepEqual(fixture.lines.flat().sort((a,b)=>a-b), [...fixture.riderIds].sort((a,b)=>a-b));
  assert.ok(fixture.riderIds.includes(fixture.trigger.actor));
  assert.ok(fixture.riderIds.includes(fixture.trigger.responder));
  assert.ok(fixture.acceptance.length >= 3);
}
const sample=fixtures.cases[0];
assert.throws(()=>assertState({...sample.state, order:Array(9).fill(1)}, sample.riderIds));
assert.throws(()=>assertState({...sample.state, speedMps:0}, sample.riderIds));
assert.throws(()=>assertState({...sample.state, remainingDistanceM:undefined}, sample.riderIds));
const memory = {riderId:'synthetic:1', kind:'habitual_observation',scope:'rider',
  bodyVerified:true,url:'https://example.org/article',
  publishedAt:'2026-01-01T00:00:00Z',collectedAt:'2026-01-01T01:00:00Z'};
const cutoff='2026-01-02T00:00:00Z';
assert.equal(eligibleMemory(memory,cutoff,'race:a'),true);
assert.equal(eligibleMemory({...memory,collectedAt:cutoff},cutoff,'race:a'),false);
assert.equal(eligibleMemory({...memory,publishedAt:cutoff},cutoff,'race:a'),false);
const intention={...memory,kind:'race_intention',scope:'race',raceId:'race:a'};
assert.equal(eligibleMemory(intention,cutoff,'race:a'),true);
assert.equal(eligibleMemory(intention,cutoff,'race:b'),false);
assert.equal(eligibleMemory({...intention,scope:'rider'},cutoff,'race:a'),false);
const form={...memory,kind:'current_form',scope:'period',validUntil:'2026-01-03T00:00:00Z'};
assert.equal(eligibleMemory(form,cutoff,'race:a'),true);
assert.equal(eligibleMemory({...form,validUntil:memory.collectedAt},cutoff,'race:a'),false);
assert.equal(eligibleMemory({...memory,bodyVerified:false},cutoff,'race:a'),false);
assert.equal(eligibleMemory(memory,'invalid','race:a'),false);
console.log('Next-brain preparation: contracts, weight conservation, duplicate invariance and cutoff checks passed.');
