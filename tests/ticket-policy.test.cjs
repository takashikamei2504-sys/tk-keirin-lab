const a=require('node:assert/strict'),B=require('../js/story-brain.js'),A=require('../js/results-audit.js'),V=require('../js/prediction-view.js'),cases=require('./engine-cases.cjs');
const outputs=cases.map(c=>({c,o:B.build(c.race,c.pack)}));
a.ok(outputs.some(({o})=>o.chosen.length<10),'a meaningful race must stop below the cap');
for(const {c,o} of outputs){
 const prior=require('../reports/phase3-comparison.json').cases.find(x=>x.id===c.id);
 a.equal(o.story.main.signature,prior.new.signature,'Phase 4 must keep the selected tactical story');
 const frozen=JSON.stringify(c.race),p=A.snapshot(c.race,o,'2026-10-01T00:00:00Z');
 a.equal(p.chosen.length,o.chosen.length);a.equal(p.selection_policy.total,o.chosen.length);a.equal(JSON.stringify(c.race),frozen);
 a.match(V.copyText(o),new RegExp('本線'+o.selection_policy.main+'点'));
 a.equal(new Set(o.chosen.map(t=>t.key)).size,o.chosen.length);
 a.equal(new Set(o.story.alternatives.map(s=>s.divergence)).size,o.story.alternatives.length,'no padding by duplicate tactical divergence');
 a.ok(o.story.alternatives.every(s=>s.audit.passed));
 a.throws(()=>A.snapshot(c.race,{...o,selection_policy:{...o.selection_policy,total:11}},'2026-10-01T00:00:00Z'),/点数|構成/);
 a.throws(()=>A.snapshot(c.race,{...o,chosen:[...o.chosen,o.chosen[0]]},'2026-10-01T00:00:00Z'),/点数|構成/);
}
console.log('PASS fewer-than-ten without padding, audited distinct alternatives, variable-count copy/save and malformed-record rejection');
