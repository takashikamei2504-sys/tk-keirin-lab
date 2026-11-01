'use strict';
const assert=require('node:assert/strict'),Brain=require('../js/story-brain.js'),Context=require('../js/rider-context.js'),Material=require('../js/race-material.js');
const sample=require('../race_sample.json');
function check(r){
 const original=JSON.stringify(r),out=Brain.build(r);assert.equal(JSON.stringify(r),original);
 assert.equal(out.chosen.length,10);assert.equal(out.chosen.filter(t=>t.group==='main').length,6);assert.equal(out.chosen.filter(t=>t.group==='alternative').length,4);assert.equal(new Set(out.chosen.map(t=>t.key)).size,10);
 assert.ok(Math.abs(out.diagnostics.terminalMass+out.diagnostics.unresolvedMass-1)<1e-9);
 assert.ok(Math.abs(out.tickets.reduce((sum,t)=>sum+t.score,0)-out.diagnostics.terminalMass)<1e-9);
 for(const s of [out.story.main,...out.story.alternatives]){
  assert.ok(Brain.MODES[s.mode]);assert.ok(!s.explanation.includes('undefined'));assert.equal(s.scenes.length,6);assert.deepEqual(s.scenes.map(x=>x.phase),Brain.STAGES);
  for(const scene of s.scenes)assert.deepEqual([...scene.order].sort((a,b)=>a-b),r.riders.map(x=>x.no).sort((a,b)=>a-b));
  assert.equal(s.scenes[3].order[0],s.leader);
  if(s.innerRider)assert.equal(s.defense,'block','an inside gap must be created by an actual preceding block');
  let previous=s.scenes[0].order;for(const move of s.movementTrace){const changed=move.order.map((n,i)=>n===previous[i]?-1:i).filter(i=>i>=0);assert.equal(changed.length,2);assert.equal(changed[1]-changed[0],1);previous=move.order;}
 }
 assert.ok(out.chosen.filter(t=>t.group==='main').every(t=>t.supporting_path===out.story.main),'six main tickets must share one complete story');
 for(const t of out.chosen)assert.ok(t.supporting_path.outcomes.some(o=>o.key===t.key));
 return out;
}
const nine=check(sample),seven=structuredClone(sample);seven.riders=seven.riders.slice(0,7);seven.lineup=seven.lineup.map(l=>l.filter(n=>n<=7)).filter(l=>l.length);check(seven);
for(const action of ['block','vertical','split','inside'])assert.ok(nine.diagnostics.considered_corner_actions.includes(action),action);
assert.equal(new Set(nine.story.alternatives.map(s=>s.divergence)).size,4);
assert.ok(nine.story.alternatives.some(s=>s.first!==nine.story.main.first),'an available different winner must appear among alternative patterns');
const reverse=structuredClone(sample);reverse.riders.reverse();assert.deepEqual(Brain.build(reverse).chosen.map(t=>t.key),nine.chosen.map(t=>t.key));
const r=structuredClone(seven);r.venue='防府';r.riders.forEach((x,i)=>x.meta={term:110+i,prefecture:'東京',rank:'S2',absent_fields:['s']});r.riders[1].meta={term:80,prefecture:'山口',rank:'SS',absent_fields:['s']};r.lineup=[[1,2,3],[4,5],[6,7]];
const c=Context.build(r);assert.ok(c.lines[0].facts.some(f=>f.includes('先輩')));assert.ok(c.lines[0].facts.some(f=>f.includes('登録地')));assert.ok(c.lines[0].facts.some(f=>f.includes('級班')));assert.ok(c.lines[0].inference.includes('推測'));
const e={rider:r.riders[0].name,peer:r.riders[1].name,kind:'assistance_received',body_verified:true,url:'https://example.org/article',published_at:'2026-10-01T00:00:00Z',collected_at:'2026-10-02T00:00:00Z',excerpt:'過去の援護への謝意'};
assert.equal(Context.build(r,{relationships:[e]}).relationships.length,1);
assert.equal(Context.build(r,{relationships:[{...e,collected_at:'2099-01-01T00:00:00Z'}]}).relationships.length,0);
assert.equal(Context.build(r,{relationships:[{...e,peer:'曖昧な姓'}]}).relationships.length,0);
const card={date:r.date,venue:r.venue,race_no:r.race_no,period:'直近4ヶ月',source_url:'https://keirin.tokyo-sports.co.jp/list/race/20261031_1',collected_at:'2026-10-31T00:00:00Z',riders:r.riders.map(x=>({no:x.no,name:x.name,s:x.no===2?19:0,term:110,prefecture:'東京',rank:'S2'})),comments:[]};
const pack={schema:'tk-keirin-race-material/v1',cards:[card]},attached=Material.attach(r,pack,Date.parse('2026-10-31T01:00:00Z'));
assert.equal(attached.race_material.covered,7);assert.equal(attached.riders[0].s,0);assert.equal(attached.riders[1].s,19);assert.equal(attached.riders[1].meta.s_measured,true);
assert.equal(Material.attach(r,{...pack,cards:[{...card,collected_at:'2099-01-01T00:00:00Z'}]}).race_material.covered,0);
const conflict=Material.attach(r,{...pack,cards:[{...card,comments:[{rider:r.riders[1].name,follow_no:4}]}]},Date.parse('2026-10-31T01:00:00Z'));
assert.throws(()=>Brain.build(conflict),/並び/);
const blocked=structuredClone(r);blocked.conditions={routes:Object.fromEntries(r.riders.map(x=>[x.no,{attack:'blocked',home:'blocked',late:'blocked',inside:'blocked',seat:'blocked'}]))};
const b=check(blocked);assert.ok(b.narratives.every(s=>!s.attacker&&!s.homeRider&&!s.cornerRider&&!s.innerRider));
console.log('PASS coherent six-stage stories, one-story main6 + alternative4, rider relationships, S cutoff, lineup conflicts and route constraints');
