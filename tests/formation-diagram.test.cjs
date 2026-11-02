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

const double=Diagram.project(F.overlaps[0],F.race),multi=Diagram.project(F.overlaps[1],F.race);
assert.equal(double.board.bands.length,3,'two outside attacks and front group use three bands');
const placement=(m,n)=>m.board.nodes.find(x=>x.no===n);
assert.equal(placement(double,4).column,placement(double,1).column,'parallel attacker aligns with the explicit leader engagement');
assert.equal(placement(double,6).column,placement(double,1).column);
assert.notEqual(placement(double,4).row,placement(double,6).row,'separate attacks are visibly stacked');
assert.equal(multi.board.bands.length,3,'multiple outside attacks plus inside route stay within three bands');
assert.equal(placement(multi,3).row,3,'explicit inside rider occupies bottom band');
assert.equal(placement(models[4],4).relation,'stopped');assert.equal(placement(models[4],4).target,null,'stopped attack must not be moved to the defender');
assert.equal(new Set(multi.board.nodes.map(n=>n.row+':'+n.column)).size,F.race.riders.length,'riders must never occupy the same drawing cell');
assert.equal(Diagram.project(legacy,F.race).board.bands.length,1,'no lateral diagram invented from prose');
assert.deepEqual(double.order,F.overlaps[0].order,'engagement layout must not rewrite engine order');
console.log('PASS three-band stacked attacks, shared target column, inside route, stopped attack and collision-free layout');

for(const s of F.overlaps9){const m=Diagram.project(s,F.race9);assert.equal(m.board.bands.length,3);assert.equal(m.board.nodes.length,9);assert.equal(new Set(m.board.nodes.map(n=>n.row+':'+n.column)).size,9);assert.deepEqual(m.order,s.order);}

const followed=Diagram.project(F.following[0],F.race),cut=Diagram.project(F.following[1],F.race),both=Diagram.project(F.following[2],F.race),cornerFollow=Diagram.project(F.following[3],F.race);
for(const m of [followed,cornerFollow]){
 assert.equal(placement(m,4).row,placement(m,5).row,'connected follower travels outside with the attacker');
 assert.equal(placement(m,5).column,placement(m,4).column+1);
 assert.equal(placement(m,5).relation,'follow');assert.equal(placement(m,5).target,4);
 assert.ok(m.connections.some(c=>c.from===4&&c.to===5&&c.type==='line'));
 assert.ok(m.riders.find(r=>r.no===5).statuses.some(s=>s.text==='追走'));
}
assert.equal(cut.riders.find(r=>r.no===5).lane,'queue','detached follower cannot be dragged along');
assert.notEqual(placement(cut,4).row,placement(cut,5).row);
assert.equal(both.board.bands.length,3,'two travelling lines consume two bands, not four');
assert.equal(placement(both,6).row,placement(both,7).row);assert.notEqual(placement(both,4).row,placement(both,6).row);
const nineFollow=Diagram.project(F.following9,F.followRace9);assert.equal(placement(nineFollow,4).row,placement(nineFollow,8).row);assert.equal(placement(nineFollow,8).column,placement(nineFollow,4).column+2);
const invalid=structuredClone(F.following[0]);invalid.tactical.connected[5]=false;assert.throws(()=>Diagram.project(invalid,F.race),/追走/);
for(const input of [sample,seven,target]){const out=Brain.build(input);for(const story of [out.story.main,...out.story.alternatives])for(const s of story.scenes){
 for(const g of s.tactical.outside_groups){
  assert.equal(g.members[0],g.head);if(s.tactical.connected[g.head]===false)assert.equal(g.members.length,1);
  const line=input.lineup.find(l=>l.includes(g.head));assert.deepEqual(g.members,line.slice(line.indexOf(g.head),line.indexOf(g.head)+g.members.length));
  for(const n of g.members.slice(1)){assert.equal(s.tactical.connected[n],true);assert.notEqual(n,s.tactical.seat);assert.notEqual(n,s.tactical.innerRider);}
 }
}}
console.log('PASS outside travelling lines, continuous followers after one-car advance, detached/independent exclusion, two-line bands and nine-car third follower');
