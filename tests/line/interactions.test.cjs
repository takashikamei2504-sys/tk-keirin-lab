'use strict';
const assert=require('node:assert/strict'),Engine=require('../../js/line/engine.js'),Input=require('../../js/line/input.js'),State=require('../../js/line/state.js'),Selection=require('../../js/line/selection.js'),View=require('../../js/line/view.js');
const sample=require('../../race_sample.json'),r=structuredClone(sample);r.lineup=[[1,2,3],[4,5,6],[7,8,9]];r.riders.forEach(x=>{x.style=[1,4,7].includes(x.no)?'逃':'追';x.score=[1,4,7].includes(x.no)?115:110;x.b=[1,4,7].includes(x.no)?14:0;x.wins=5;x.seconds=5;x.thirds=5;x.outs=10;});
const stamp='2026-10-01T00:00:00Z',pack={evidence:r.riders.flatMap(x=>['recover','inside','block','track','long_makuri','seat'].map(trait=>({id:`${x.no}-${trait}`,rider:x.name,trait,value:trait==='track'?.05:.98,confidence:1,body_verified:true,url:`https://example.org/line-fixture/${x.no}/${trait}`,excerpt:'架空の戦術観察・検証専用',published_at:stamp,collected_at:stamp})))};
const out=Engine.build(r,{intelligence:pack},{width:160,traceCandidates:true}),all=out.candidate_evaluations;
let checked=0;function ok(x,message){assert.ok(x,message);checked++;}
for(const candidate of all)for(const scene of candidate.scenes){assert.deepEqual([...scene.order].sort(),r.riders.map(x=>x.no).sort());checked++;if(scene.phase!==Engine.PHASES[5]){assert.deepEqual(scene.groups.flatMap(g=>g.members).sort(),r.riders.map(x=>x.no).sort());checked++;}}
const simultaneous=all.find(c=>c.scenes[3].groups.some(g=>g.lane===1&&g.attack)&&c.scenes[3].groups.some(g=>g.lane===2&&g.attack));ok(simultaneous,'independent two-line attacks survive to the final back');
ok(simultaneous.attacks.some(a=>a.kind==='counter'&&a.responding_to),'the second attack is a response to the first');
const stopped=all.find(c=>c.scenes[2].events.some(e=>e.action==='stalled')&&c.scenes[3].events.some(e=>e.action==='recover'));
ok(stopped,'failure and recovery must occupy separate phases');
const relaunched=all.find(c=>c.attacks.some(a=>a.kind==='relaunch'&&a.after_failure));ok(relaunched,'middle-position retry has an actual previous failure');
const reconnected=all.find(c=>c.recovered_riders.length&&c.scenes[3].events.some(e=>e.action==='reconnect'));ok(reconnected,'detached riders can recover after a genuine prior loss');
for(const no of reconnected.recovered_riders){const group=reconnected.scenes[3].groups.find(g=>g.members.includes(no));ok(group.members.at(-1)===no,'recovery rejoins the tail, never teleports back to second');}
const inside=all.find(c=>c.inside);ok(inside,'inside route is generated');ok(inside.defenses.some(d=>d.action==='block'),'inside opening requires an actual defensive move');ok(inside.scenes[4].events.some(e=>e.action==='inside'),'route entry is represented in the corner');
const blockOutcomes=new Set(all.flatMap(c=>c.defenses).filter(d=>d.action==='block').map(d=>d.outcome));assert.deepEqual([...blockOutcomes].sort(),['failure','partial','success']);checked++;
// Diagram must preserve every rider without overlap, including attacks in two lanes and a detachment.
for(const candidate of [simultaneous,inside,reconnected])for(const scene of candidate.scenes.slice(0,5)){
 const svg=View.diagram(scene,out),circles=[...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)"/g)].map(m=>m[1]+','+m[2]);ok(circles.length===9,'all riders appear in diagram');ok(new Set(circles).size===9,'no diagram circle overlap');
}
// A strong kamashi record must not silently count as a strong short makuri record.
const specialties=Input.prepare(r,{intelligence:{evidence:[{...pack.evidence[0],rider:r.riders[0].name,trait:'kamashi',value:.99,url:'https://example.org/line-fixture/specialty/kamashi'},{...pack.evidence[0],rider:r.riders[0].name,trait:'makuri',value:.01,url:'https://example.org/line-fixture/specialty/makuri'}]}});
ok(specialties.features[1].kamashi.value>specialties.features[1].makuri.value,'kamashi and makuri retain opposite observed specialties');
ok(specialties.features[1].makuri.sources.every(s=>s.trait!=='kamashi'),'the short makuri ledger does not borrow the kamashi article');
// Explicit, pre-race competition comments must identify a real leader and a real incumbent.
const contested=structuredClone(r);contested.lineup=[[1,2,3],[4,5],[6,7],[8],[9]];
const comment={rider:contested.riders.find(x=>x.no===9).name,kind:'race_intention',lineup_intention:'compete',follow_no:1,body_verified:true,url:'https://example.org/line-fixture/competition',published_at:stamp,collected_at:stamp,race_id:`${r.date}:${r.venue}:${r.race_no}`,excerpt:'1番の番手に競る（検証専用）'};
contested.race_material={comments:[comment],lineup_conflicts:[comment.rider+'は競り・直付けを表明']};
const duel=Engine.build(contested,{intelligence:pack},{width:128,traceCandidates:true});
ok(duel.input.race.contests.length===1,'explicit target is resolved from the existing comments');
const duelEvents=duel.candidate_evaluations.flatMap(c=>c.scenes).flatMap(s=>s.events);ok(duelEvents.some(e=>e.action==='seat_won'),'competition can be won');ok(duelEvents.some(e=>e.action==='seat_held'),'incumbent can hold the seat');
const held={...contested,race_material:{comments:[{...comment,follow_no:null}]}};assert.throws(()=>Engine.build(held),/競り先/);checked++;
const future=structuredClone(contested);future.race_material.comments=[{...comment,published_at:'2099-01-01T00:00:00Z',collected_at:'2099-01-02T00:00:00Z'}];ok(Input.prepare(future).race.contests.length===0,'post-start competition cannot change the race model');
// A misleading largest spread must be reconsidered if it cannot separate the two leading hypotheses.
function fake(id,values){return {id,terms:Object.entries(values).map(([axis,value])=>({phase:1,axis,value,reason:axis+'の比較',features:[]})),finish:{pair:[id,id+3],mode:'比較用'},scenes:[{events:[]},{events:[{actor:id,action:'press'}]}],detached:[],switches:{}};}
const choice=Selection.select([fake(1,{rationality:.9,feasibility:.9,evidence:0,interaction:.9,robustness:.9}),fake(2,{rationality:.8,feasibility:.9,evidence:0,interaction:.9,robustness:1}),fake(3,{rationality:.7,feasibility:.7,evidence:.4,interaction:.7,robustness:.7})]);
ok(choice.decision.rounds.length>1,'zero difference in the initially proposed axis triggers reconsideration');ok(choice.main.axes[choice.decision.axis]>choice.rival.axes[choice.decision.axis],'final priority genuinely distinguishes main and rival');
for(const contrast of choice.decision.contrasts)assert.equal(contrast.weighted_difference,(contrast.main-contrast.rival)*choice.decision.weights[contrast.axis]);checked++;
// Source-bound condition observations alter the comparison; future and untyped conditions do not.
const condition={kind:'wind',speed_mps:7,home_direction:'headwind',verified:true,source_url:'https://example.org/line-fixture/wind',published_at:'2026-10-31T05:00:00Z',collected_at:'2026-10-31T05:10:00Z'};
const conditioned=Engine.build({...r,conditions:{observations:[condition]}},{},{asOf:Date.parse('2026-10-31T05:11:00Z'),width:32});ok(conditioned.environment.used.length===1,'verified timely wind observation is actually used');ok(conditioned.main.terms.some(t=>t.features.some(f=>f.key==='wind')),'used wind adjustment is visible in the decision ledger');
const matching=Input.prepare(r,{conditions:{schema:'tk-line-conditions/v1',snapshots:[{...condition,venue:r.venue}]}},Date.parse('2026-10-31T05:11:00Z'));ok(matching.race.conditions.observations.length===1,'shared observations are attached without manual prediction input');const wrongVenue=Input.prepare(r,{conditions:{schema:'tk-line-conditions/v1',snapshots:[{...condition,venue:'架空の別会場'}]}},Date.parse('2026-10-31T05:11:00Z'));ok(wrongVenue.race.conditions.observations.length===0,'a different bank cannot change this race');
const stale=Input.prepare({...r,conditions:{observations:[{...condition,collected_at:'2026-10-30T05:00:00Z'}]}});ok(stale.race.conditions.observations.length===0,'stale or time-inconsistent wind is not used');
// Semantically impossible states fail before scoring.
const broken=structuredClone(out.main);broken.scenes[3].order[0]=broken.scenes[3].order[1];ok(!State.audit(broken,r,Object.fromEntries(out.topology.lines.map(l=>[l.id,l]))).passed,'a large score cannot rescue a duplicated rider');
console.log(`PASS LINE interactions: ${checked} assertions; simultaneous attacks, recovery, retry, seat competition, inside route, truthful axis, diagram uniqueness and timestamped conditions`);
