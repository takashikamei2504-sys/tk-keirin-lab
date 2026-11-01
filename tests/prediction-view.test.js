const assert=require('node:assert/strict'),fs=require('node:fs'),Brain=require('../js/race-brain.js'),View=require('../js/prediction-view.js');
const race=JSON.parse(fs.readFileSync('race_sample.json','utf8')),out=Brain.build(race),groups=View.group(out.chosen);
assert.equal(groups.flatMap(g=>g.tickets).length,20);assert.equal(new Set(groups.flatMap(g=>g.tickets.map(t=>t.key))).size,20);
for(const g of groups)for(const t of g.tickets)for(const key of ['mode','front','attacker','stand','tactic','outcome','gap','first'])assert.equal(t.supporting_path[key],g.path[key],key);
assert.deepEqual(out.chosen.map(t=>t.key),Brain.build(race).chosen.map(t=>t.key),'presentation must not change picks');
console.log('PASS every chosen ticket belongs to exactly one matching causal scenario, no model changes');

const examples=['1-2-5','1-2-3','2-1-3','1-2-4','2-1-7'].map(key=>({key,trio:key.split('-').map(Number)}));
const packed=View.compact(examples);assert.deepEqual(packed.map(r=>r.label),['1-2-345','2-1-37']);assert.deepEqual(packed.map(r=>r.count),[3,2]);
function expand(rows){return rows.flatMap(r=>r.label.split('-')[2].split('').map(n=>r.pair+'-'+n)).sort();}
assert.deepEqual(expand(packed),examples.map(t=>t.key).sort());assert.deepEqual(expand(View.compact(out.chosen)),out.chosen.map(t=>t.key).sort());assert.equal(View.compact([...examples,examples[0]]).reduce((sum,r)=>sum+r.count,0),5);
assert.match(View.copyText({...out,chosen:examples}),/1-2-345（3点）/);assert.match(View.copyText({...out,chosen:examples}),/2-1-37（2点）/);assert.throws(()=>View.compact([{trio:[1,1,2]}]));
console.log('PASS compact first/second pairs, sorted thirds, exact ticket-set preservation, counts and copy format');
