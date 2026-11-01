const assert=require('node:assert/strict'),fs=require('node:fs'),Brain=require('../js/race-brain.js'),View=require('../js/prediction-view.js');
const race=JSON.parse(fs.readFileSync('race_sample.json','utf8')),out=Brain.build(race),groups=View.group(out.chosen);
assert.equal(groups.flatMap(g=>g.tickets).length,20);assert.equal(new Set(groups.flatMap(g=>g.tickets.map(t=>t.key))).size,20);
for(const g of groups)for(const t of g.tickets)for(const key of ['mode','front','attacker','stand','tactic','outcome','gap','first'])assert.equal(t.supporting_path[key],g.path[key],key);
assert.deepEqual(out.chosen.map(t=>t.key),Brain.build(race).chosen.map(t=>t.key),'presentation must not change picks');
console.log('PASS every chosen ticket belongs to exactly one matching causal scenario, no model changes');
