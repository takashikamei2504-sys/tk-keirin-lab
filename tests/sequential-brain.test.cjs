'use strict';
const assert=require('node:assert/strict');
const brain=require('../js/race-brain-v2.js');
const sample=require('../race_sample.json');
const fixtures=require('../research/next-brain/fixtures.json');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
function check(r,options){
 const o=brain.build(r,{},options),ids=r.riders.map(x=>x.no).sort((a,b)=>a-b);
 assert.equal(o.version,'sequential-causal-v2.0.0');
 assert.equal(o.chosen.length,20);assert.equal(new Set(o.chosen.map(t=>t.key)).size,20);
 near(o.diagnostics.terminalMass+o.diagnostics.unresolvedMass,1);
 near(o.tickets.reduce((sum,t)=>sum+t.score,0),o.diagnostics.terminalMass);
 for(const n of o.narratives){
  assert.equal(n.snapshots.length,5);
  for(const s of n.snapshots)assert.deepEqual([...s.order].sort((a,b)=>a-b),ids);
  let previous=n.snapshots[0].order;
  for(const event of n.movementTrace){const changed=event.order.map((id,i)=>id===previous[i]?-1:i).filter(i=>i>=0);assert.equal(changed.length,2);assert.equal(changed[1]-changed[0],1);previous=event.order;assert.deepEqual([...event.order].sort((a,b)=>a-b),ids);assert.equal(event.kind,'adjacent_crossing');assert.equal(event.feasibility,'unknown');}
  assert.equal(new Set(n.trio).size,3);assert.ok(Number.isFinite(n.score)&&n.score>0);
  if(n.mode==='recovery')assert.equal(n.gap,'breaks');
  if(n.mode==='seat'){assert.equal(n.gap,'breaks');assert.equal(n.first,n.seat);}
  if(n.mode==='thirdsprint')assert.equal(n.gap,'holds');
  if(n.mode==='thirdline'){assert.equal(n.stand,'resist');assert.notEqual(n.first,n.front);assert.notEqual(n.first,n.attacker);}
  if(n.mode==='counter'){assert.equal(n.stand,'yield');assert.equal(n.outcome,'attacker-takes');}
 }
 for(const t of o.chosen){assert.equal(t.key,t.supporting_path.key);assert.ok(t.paths.includes(t.supporting_path));}
 return o;
}
const nine=check(sample);near(nine.diagnostics.unresolvedMass,0);
assert.equal(nine.keymen.length,3);assert.ok(nine.keymen.every(k=>k.coverage>.99));
assert.equal(new Set(nine.narratives.map(n=>n.mode)).size,10);
const seven=structuredClone(sample);seven.riders=seven.riders.slice(0,7);seven.lineup=seven.lineup.map(l=>l.filter(n=>n<=7)).filter(l=>l.length);check(seven);
const reversed=structuredClone(sample);reversed.riders.reverse();
assert.deepEqual(brain.build(reversed).chosen.map(t=>t.key),nine.chosen.map(t=>t.key));
const bounded=check(sample,{width:8});assert.ok(bounded.diagnostics.unresolvedMass>0);
// All known external routes blocked: no attack or external late move survives.
const blocked=structuredClone(sample);blocked.conditions={routes:Object.fromEntries(blocked.riders.map(x=>[x.no,{attack:'blocked',late:'blocked',seat:'blocked'}]))};
const bo=check(blocked);assert.ok(bo.narratives.every(n=>n.attacker===null));
assert.ok(bo.narratives.every(n=>['lead','sashi','thirdsprint'].includes(n.mode)));
assert.throws(()=>brain.build({...sample,start:'invalid'}));
assert.throws(()=>brain.build({...sample,lineup:[[1,1,2,3,4,5,6,7,8]]}));
const evidence={rider:sample.riders[0].name,trait:'resist',value:1,confidence:1,body_verified:true,url:'https://example.org/observation',published_at:'2026-10-01T00:00:00Z',collected_at:'2026-10-02T00:00:00Z'};
const changed=brain.build(sample,{evidence:[evidence]});
assert.notEqual(changed.tickets[0].score,nine.tickets.find(t=>t.key===changed.tickets[0].key).score);
const future=brain.build(sample,{evidence:[{...evidence,collected_at:'2099-01-01T00:00:00Z'}]});
assert.deepEqual(future.chosen.map(t=>[t.key,t.score]),nine.chosen.map(t=>[t.key,t.score]));
const mismatchedContext=brain.build(sample,{evidence:[{...evidence,context:{phase:'最終バック'}}]});
assert.deepEqual(mismatchedContext.chosen.map(t=>[t.key,t.score]),nine.chosen.map(t=>[t.key,t.score]));
const comments=brain.build(sample,{observations:[{...evidence,trait:undefined,kind:'interview_comment',excerpt:'前で走りたい'}]});
assert.equal(comments.intelligence.memory_count,1);assert.equal(comments.intelligence.evidence_count,0);
assert.deepEqual(comments.chosen.map(t=>[t.key,t.score]),nine.chosen.map(t=>[t.key,t.score]));
for(const f of fixtures.cases){
 const race={...sample,lineup:f.lines,riders:f.riderIds.map(no=>({no,name:`架空${no}`,score:105,style:f.lines.some(l=>l[0]===no)?'逃':'両'}))};
 const o=check(race);
 assert.ok(o.narratives.some(n=>n.stand==='resist'));
 assert.ok(o.narratives.some(n=>n.stand==='yield'));
 if(f.id==='follow-gap-multiple-reactions'){
  assert.ok(o.narratives.some(n=>n.mode==='recovery'));
  assert.ok(o.narratives.some(n=>n.gap==='breaks'&&n.mode!=='recovery'));
 }
}
console.log('PASS sequential 7/9 scenarios, contextual memory/cutoff, route constraints, mass conservation, bounded search and causal ticket paths');
