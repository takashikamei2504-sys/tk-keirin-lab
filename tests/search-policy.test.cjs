const a=require('node:assert/strict'),S=require('../js/search-policy.js'),B=require('../js/story-brain.js');
const make=(i,mass=1)=>({stage:1,order:[1,2,3,4,5,6,7],energy:{1:0},connected:{},outside:[],front:1,attacker:i%2?4:6,tactic:i%2?'press':'kamashi',stand:'yield',leader:i%2?4:6,analysisCost:i*.001,auditFailures:0,mass,starter:i});
const input=Array.from({length:30},(_,i)=>make(i)),out=S.retain(input,8,'test');a.equal(out.kept.length,8);a.equal(new Set(out.kept.map(S.family)).size,2);a.ok(Math.abs(out.kept.reduce((n,s)=>n+s.mass,0)+out.droppedMass-30)<1e-10);
const duplicate=S.retain([make(1),make(1)],8,'test');a.equal(duplicate.kept.length,1);a.equal(duplicate.kept[0].mass,2);a.equal(duplicate.trace.merged,1);
for(const c of require('./engine-cases.cjs')){const x=B.build(c.race,c.pack);a.equal(x.story.selection_review.compared[0].selected,true);a.ok(x.story.selection_review.compared[0].passed);a.ok(x.diagnostics.search_trace.every(t=>t.retained<=x.diagnostics.width));a.ok(Math.abs(x.diagnostics.terminalMass+x.diagnostics.unresolvedMass-1)<1e-9);}
console.log('PASS bounded family diversity, semantic duplicates, mass accounting and whole-race self-counterexample selection');
