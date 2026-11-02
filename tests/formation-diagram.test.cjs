'use strict';
const assert=require('node:assert/strict'),Brain=require('../js/story-brain.js'),Diagram=require('../js/formation-diagram.js'),F=require('./formation-fixtures.cjs');
const sample=require('../race_sample.json'),seven=structuredClone(sample);seven.riders=seven.riders.slice(0,7);seven.lineup=seven.lineup.map(l=>l.filter(n=>n<=7)).filter(l=>l.length);
const target=require('../data/lab_history/2026-11-02.json').predictions.find(p=>p.input?.venue==='防府'&&p.input.race_no===12).input;
for(const race of [sample,seven,target]){
 const out=Brain.build(race),before=JSON.stringify(out);
 for(const story of [out.story.main,...out.story.alternatives])story.scenes.forEach((s,i)=>{
  const model=Diagram.project(s,race,story.scenes[i-1]);assert.deepEqual(model.order,s.order);assert.equal(model.riders.length,race.riders.length);assert.equal(new Set(model.riders.map(r=>r.no)).size,race.riders.length);
  assert.ok(model.riders.every(r=>r.label&&r.name));assert.match(Diagram.render(model,{storyId:story.id}),/formation-diagram/);
  if(s.stage===6)assert.deepEqual(model.finish.podium.map(x=>x.no),i===5&&story===out.story.main?out.chosen[0].trio:out.chosen.find(t=>t.group==='alternative'&&t.supporting_path.id===story.id).trio);
 });
 assert.equal(JSON.stringify(out),before,'projection must not mutate any forecast state, text or ticket');
}
const predecessors=[null,F.cases[0],F.cases[1],F.cases[2],F.scene(4),F.scene(4),F.cases[5]];
const models=F.cases.map((s,i)=>Diagram.project(s,F.race,predecessors[i]));
assert.equal(models[0].riders.find(r=>r.no===2).statuses.some(s=>s.text==='S取り'),true);
assert.deepEqual(models[0].riders.map(r=>r.lane),Array(7).fill('queue'));
assert.equal(models[1].encounter.response,'突っ張り');assert.equal(models[1].encounter.attacker,4);assert.equal(models[1].encounter.front,1);
assert.deepEqual(models[2].outside,[4]);assert.equal(models[2].riders.find(r=>r.no===2).separated,true);assert.ok(!models[2].connections.some(c=>c.to===2&&c.type==='line'));
assert.equal(models[3].riders.find(r=>r.no===4).statuses.some(s=>s.text==='番手はまり'),true);
assert.equal(models[3].riders.find(r=>r.no===2).separated,true,'detached riders must stay visibly detached in the next scene');
assert.equal(models[4].riders.find(r=>r.no===4).position,4,'successful block cannot advance the attacker');assert.equal(models[4].riders.find(r=>r.no===4).statuses[0].text,'止まる');
assert.equal(models[4].inside,3);assert.equal(models[4].riders.find(r=>r.no===3).lane,'inside');assert.ok(models[4].events.some(e=>e.type==='block'&&e.actor===2&&e.target===4));
assert.ok(models[5].events.some(e=>e.type==='vertical'));assert.equal(models[5].inside,null);
assert.deepEqual(models[6].finish.podium.map(r=>r.no),[2,1,3]);assert.deepEqual(models[6].finish.podium[0].passed,[1]);
const legacy={...F.cases[4],tactical:undefined,action:'ブロックして内を突くとの文章だけ'};assert.deepEqual(Diagram.project(legacy,F.race).outside,[],'prose alone cannot invent a lateral state');assert.equal(Diagram.project(legacy,F.race).inside,null);
assert.throws(()=>Diagram.project({...F.cases[4],order:[1,4,2,3,5,6,7]},F.race),/ブロック/);
assert.throws(()=>Diagram.project({...F.cases[4],tactical:{...F.cases[4].tactical,openInside:false}},F.race),/内の進路/);
const revived=structuredClone(F.cases[3]);revived.tactical.connected[2]=true;assert.throws(()=>Diagram.project(revived,F.race,F.cases[2]),/復帰/);
const unsafe=structuredClone(F.race);unsafe.riders[0].name='<img src=x onerror=alert(1)>';assert.ok(!Diagram.render(Diagram.project(F.cases[0],unsafe)).includes('<img'));
console.log('PASS exact 7/9 scene projection, identity, lanes, gaps, block/inside, overtakes, alternate tickets and non-mutation');
