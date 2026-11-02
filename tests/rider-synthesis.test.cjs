'use strict';
const assert=require('node:assert/strict'),Memory=require('../js/brain-memory.js'),Brain=require('../js/story-brain.js'),Reasons=require('../js/decision-reasons.js'),Context=require('../js/rider-context.js');
const r=structuredClone(require('../race_sample.json'));r.date='2026-11-03';r.start='16:25';
const rider=r.riders[0],no=rider.no;
function note(excerpt,extra={}){return {id:'synthesis',rider:rider.name,kind:'self_statement',excerpt,url:'https://example.org/interview',body_verified:true,published_at:'2026-11-02T00:00:00Z',collected_at:'2026-11-02T01:00:00Z',topics:['condition'],attribution:'選手の見出しと発言欄を照合',...extra};}
const fatigue=note('まだ疲れが残っていますね'),positive=note('状態は良いです'),neutral=note('フレームを換えました',{topics:['equipment']});
function memory(n){return Memory.build(r,{knowledge:[n]});}
assert.ok(Memory.review(.5,memory(fatigue),no,'makuri').value<.5,'general fatigue must influence actual tactical trait');
assert.ok(Memory.review(.5,memory(positive),no,'finish').value>.5,'current positive condition can weakly support late energy');
assert.equal(Memory.review(.5,memory(neutral),no,'makuri').value,.5,'equipment mention alone is not improved performance');
assert.match(Memory.synthesize(memory(neutral),no).summary,/効果を確定できる材料は不足/);
for(const bad of [note('疲れは残っていない'),note('太田君が疲れが残っています'),note(r.riders[1].name+'が疲れが残っています'),note('疲れが残っていれば苦しい'),note('状態は良いです',{truncated:true}),note('状態は良いです',{published_at:'2025-01-01T00:00:00Z',collected_at:'2025-01-02T00:00:00Z'})]){
 const q=Memory.synthesize(memory(bad),no);
 if(bad.excerpt==='疲れは残っていない')assert.ok(q.axes.readiness.value>=0,'negation must not reverse the meaning');
 else assert.equal(q.axes.readiness.value,0,'opponent/conditional/truncated/stale statements must not become readiness');
}
for(const bad of [{...fatigue,collected_at:'2099-01-01T00:00:00Z'},{...fatigue,body_verified:false},{...fatigue,rider_id:'999999'}])assert.equal(memory(bad).length,0);
const dup=Memory.build(r,{knowledge:[fatigue,{...fatigue,id:'duplicate'}],observations:[fatigue]});
assert.equal(Memory.review(.5,dup,no,'makuri').value,Memory.review(.5,memory(fatigue),no,'makuri').value,'same source/quote cannot add a vote through another feed');
const contradict=Memory.build(r,{knowledge:[fatigue,positive]});assert.ok(Math.abs(Memory.review(.5,contradict,no,'makuri').value-.5)<Math.abs(Memory.review(.5,memory(fatigue),no,'makuri').value-.5));
const opposite=Memory.build(r,{knowledge:[fatigue,{...positive,url:'https://example.org/positive'}]});assert.ok(Memory.qualitative(opposite,no,'makuri',[fatigue.url]).delta>0,'excluding a direct-action article must recompute the remaining evidence direction');
const baseline=Brain.build(r),enriched=Brain.build(r,{knowledge:[fatigue]});
assert.equal(enriched.intelligence.knowledge_count,1);assert.equal(enriched.profiles[no].qualitative.source_count,1);
assert.notEqual(enriched.reproducibility.input_sha256,baseline.reproducibility.input_sha256);
assert.ok(enriched.reproducibility.replay_pack.knowledge.length,'source must survive freezing/replay');
const replay=Brain.build(r,enriched.reproducibility.replay_pack,enriched.reproducibility.search_settings);assert.deepEqual(replay.chosen.map(t=>t.key),enriched.chosen.map(t=>t.key));assert.equal(replay.reproducibility.input_sha256,enriched.reproducibility.input_sha256);
assert.notEqual(JSON.stringify(enriched.story.selection_review),JSON.stringify(baseline.story.selection_review),'general material must change comparison, not just profile metadata');
const state={stage:2,leader:r.riders.find(x=>x.no!==no).no,order:r.lineup.flat(),energy:Object.fromEntries(r.riders.map(x=>[x.no,0]))};
const reason=Reasons.build(r,memory(fatigue),Context.build(r)).evaluate('home-attack',{key:String(no),actor:no},state);
assert.ok(reason.facts.some(f=>f.kind==='qualitative_statement'&&f.source.url===fatigue.url));assert.match(reason.inferences.join('。'),/疲労・調整/);
const recovered=Brain.build(r,{knowledge:[]});assert.deepEqual(recovered.chosen.map(t=>t.key),baseline.chosen.map(t=>t.key));
console.log('PASS attributed rider synthesis affects tactical comparison, preserves negation/cutoff/identity, bounds duplicates and freezes exact replay');
