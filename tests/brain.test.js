const assert=require('node:assert/strict');
const fs=require('node:fs');const {build,profiles}=require('../js/race-brain.js');
const sample=JSON.parse(fs.readFileSync('race_sample.json','utf8'));
function check(r){
 const result=build(r);assert.equal(result.chosen.length,20);assert.equal(new Set(result.chosen.map(t=>t.key)).size,20);
 for(const n of result.narratives){assert.equal(n.snapshots.length,5);for(const s of n.snapshots){assert.equal(new Set(s.order).size,r.riders.length);assert.deepEqual([...s.order].sort(),r.riders.map(x=>x.no).sort());}assert.equal(new Set(n.trio).size,3);assert(Number.isFinite(n.score)&&n.score>0);}
 assert(result.keymen.length>0);assert(result.keymen.every(k=>k.matched_contexts>0));
 return result;
}
const nine=check(sample);const seven=structuredClone(sample);seven.riders=seven.riders.slice(0,7);const ids=new Set(seven.riders.map(x=>x.no));seven.lineup=seven.lineup.map(l=>l.filter(n=>ids.has(n))).filter(l=>l.length);check(seven);
for(const mode of ['seat','recovery','outer'])assert(nine.narratives.some(n=>n.mode===mode),mode);
const early='2020-01-01T00:00:00Z',later='2099-01-01T00:00:00Z';
const e={id:'test',rider:sample.riders[0].name,trait:'resist',value:1,confidence:1,url:'https://keirin.jp/article',body_verified:true,published_at:early,collected_at:early};
const p0=profiles(sample),p1=profiles(sample,{evidence:[e]}),pf=profiles(sample,{evidence:[{...e,collected_at:later}]});
assert(p1.get(sample.riders[0].no).resist>p0.get(sample.riders[0].no).resist);
assert.equal(pf.get(sample.riders[0].no).resist,p0.get(sample.riders[0].no).resist);
assert.equal(profiles(sample,{evidence:[{...e,body_verified:false}]}).get(sample.riders[0].no).evidence.length,0);
const r2=structuredClone(sample);r2.riders.reverse();assert.deepEqual(build(r2).chosen.map(t=>t.key),nine.chosen.map(t=>t.key));
const changed=build(sample,{evidence:[{...e,trait:'resist',published_at:'2026-10-01T00:00:00Z',collected_at:'2026-10-01T00:00:00Z'}]});
assert.notEqual(changed.tickets.find(t=>t.key===nine.tickets[0].key).score,nine.tickets[0].score);
console.log(`PASS: 7/9 riders, 20 unique tickets, all state permutations, article influence, leakage cutoff, stable input order. ${nine.narratives.length} paths.`);
