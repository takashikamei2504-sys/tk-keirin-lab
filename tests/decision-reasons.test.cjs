'use strict';
const assert=require('node:assert/strict'),Reasons=require('../js/decision-reasons.js'),Memory=require('../js/brain-memory.js'),Context=require('../js/rider-context.js'),Material=require('../js/race-material.js'),Brain=require('../js/story-brain.js');
const race=structuredClone(require('../race_sample.json'));race.date='2026-11-03';race.start='16:25';
const x=race.riders[0],no=x.no;
const comment={rider:x.name,kind:'race_intention',race_id:Memory.raceKey(race),declaration:'先行基本に積極的に',excerpt:'前回の反省を踏まえて走ります',body_verified:true,url:'https://example.org/card',published_at:'2026-11-02T00:00:00Z',collected_at:'2026-11-02T00:00:00Z'};
const state={stage:1,front:race.lineup.find(l=>l[0]!==no)[0],leader:race.lineup.find(l=>l[0]!==no)[0],energy:Object.fromEntries(race.riders.map(r=>[r.no,0])),order:race.lineup.flat()};
function reasons(rows){return Reasons.build(race,Memory.build(race,{observations:rows}),Context.build(race));}
const press={key:`${no}:press`,actor:no},base=reasons([]).evaluate('red-attack',press,state),declared=reasons([comment]).evaluate('red-attack',press,state);
assert.ok(declared.multiplier>base.multiplier,'an attributed current lead plan must actually influence the red-attack choice');assert.ok(declared.facts.some(f=>f.kind==='race_intention'&&f.source.url===comment.url));
for(const bad of [{...comment,collected_at:'2026-11-04T00:00:00Z'},{...comment,race_id:'2026-11-01:別会場:1'},{...comment,body_verified:false},{...comment,declaration_complete:false}])assert.equal(reasons([bad]).evaluate('red-attack',press,state).multiplier,base.multiplier);
const negative={...comment,declaration:'先行はしない'};assert.equal(reasons([negative]).evaluate('red-attack',press,state).multiplier,base.multiplier);
for(const text of ['先行した','先行するつもりはない','捲りません','前回は突っ張った','できれば先行'])assert.deepEqual(Reasons.plans(text),[],text);
const revised={...comment,declaration:'捲りで',collected_at:'2026-11-02T01:00:00Z'};
assert.ok(reasons([comment,revised]).evaluate('red-attack',press,state).multiplier<base.multiplier,'a revised plan sharing its opening excerpt must supersede the earlier plan');
const out=Brain.build(race,{observations:race.riders.map(x=>({...comment,rider:x.name}))});
for(const story of [out.story.main,...out.story.alternatives]){
 for(const scene of story.scenes){assert.ok(scene.reasoning);assert.ok(scene.reasoning.decisions.every(d=>d.basis===d.reasoning.basis));}
 assert.ok(story.decisions.some(d=>d.reasoning.facts.some(f=>f.kind==='race_intention'&&f.source.url===comment.url)));
}
// Old notes must not conflict with a revised statement, and explicit competition must stop the single-line engine.
const card={date:race.date,venue:race.venue,race_no:race.race_no,period:'直近4ヶ月',source_url:'https://keirin.tokyo-sports.co.jp/list/race/20261102_1',collected_at:'2026-11-02T00:00:00Z',riders:race.riders.map(r=>({...r,s:0})),comments:[]};
const follower=race.lineup.find(l=>l.length>=2)[1],leader=race.lineup.find(l=>l.includes(follower))[0],name=race.riders.find(r=>r.no===follower).name;
function note(extra={},stamp=card.collected_at){return {...comment,rider:name,race_id:Memory.raceKey(race),url:card.source_url,collected_at:stamp,published_at:stamp,...extra};}
const early={...card,comments:[note({follow_no:race.riders.find(r=>!race.lineup.find(l=>l.includes(follower)).includes(r.no)).no})]};
const late={...card,collected_at:'2026-11-02T01:00:00Z',comments:[note({follow_no:leader,follow_position:'immediate'},'2026-11-02T01:00:00Z')]};
const pack={schema:'tk-keirin-race-material/v1',cards:[late,early]};
const clean=Material.attach(race,pack,Date.parse('2026-11-02T02:00:00Z'));assert.equal(clean.race_material.lineup_conflicts.length,0);assert.equal(clean.race_material.lineup_checks.length,1);assert.equal(clean.race_material.comments.length,1);
const contested=Material.attach(race,{...pack,cards:[{...card,comments:[note({lineup_intention:'compete'})]}]},Date.parse('2026-11-02T02:00:00Z'));assert.throws(()=>Brain.build(contested),/競り/);
const invalid=Material.attach(race,{...pack,cards:[{...card,comments:[note({follow_no:leader,body_verified:false})]}]},Date.parse('2026-11-02T02:00:00Z'));assert.equal(invalid.race_material.comments.length,0);
console.log('PASS choice weights and explanations share scoped evidence; revised comments, stale/ambiguous data and contested lineup are handled');
