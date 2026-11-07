'use strict';
const assert = require('node:assert/strict');
const Calibration = require('../js/roi/calibration.cjs');
const Value = require('../js/roi/value.cjs');
const Policy = require('../js/roi/policy.cjs');

for (const [n,size] of [[7,210],[9,504]]) {
  const branches = Calibration.design(Array.from({length:n},(_,i)=>i+1),[['1-2-3',1]]);
  const distribution = Calibration.predict(branches,[4,2,1]);
  assert.equal(distribution.size,size);
  assert(Math.abs([...distribution.values()].reduce((a,b)=>a+b,0)-1)<1e-12);
  assert(distribution.get('1-2-3')>distribution.get('3-2-1'));
}
const row = {start:1,result_at:2,winners:['1-2-3'],
  branches:Calibration.design([1,2,3,4,5,6,7],[['1-2-3',1]])};
const calibration = Calibration.train([row,{...row,result_at:3},{...row,start:4,result_at:5}],3);
assert.equal(calibration.training_races,1);
assert.equal(calibration.holdout.races,1);
assert.equal(calibration.eligible,false);
const asOf = '2026-11-07T09:00:00Z', cutoff = '2026-11-07T09:10:00Z';
const candidate = {key:'1-2-3',trio:[1,2,3],evidence:[{reason:'先行'}]};
const snapshot = {race_id:'race',source_url:'https://example.test/odds',market:'trifecta',state:'live',
  published_at:'2026-11-07T08:58:00Z',captured_at:'2026-11-07T08:59:00Z',sales_close_at:'2026-11-07T09:07:00Z',
  odds:{'1-2-3':80}};
const p = {raceId:'race',candidates:[candidate,candidate],probabilities:new Map([['1-2-3',.025]]),
  calibration:{eligible:true,lower_factor:.70},asOf,cutoff,snapshot};
assert.equal(Value.optimize(p).tickets.length,1);
assert.equal(Value.optimize({...p,threshold:1.30}).tickets.length,0);
assert.equal(Value.optimize({...p,calibration}).decision,'pass');
assert.equal(Value.optimize({...p,snapshot:{...snapshot,state:'final'}}).reason,'odds');
assert.equal(Value.optimize({...p,snapshot:{...snapshot,published_at:'2026-11-07T08:00:00Z'}}).reason,'odds');
assert.equal(Value.optimize({...p,asOf:snapshot.sales_close_at}).reason,'odds');
assert.notEqual(Policy.model({eligible:false}).model_id,Policy.model({eligible:true}).model_id);
console.log('ROI policy: normalized 210/504, chronological fit, stale/closing odds, conservative EV and dedupe OK');
