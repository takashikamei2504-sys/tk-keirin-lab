'use strict';
const assert=require('node:assert/strict');
const Positioning=require('../../js/line/positioning.js');
const E=require('../../js/line/engine.js');
const fixture=require('../../race_sample.json');
let checks=0;
function ok(value,msg){assert.ok(value,msg);checks++;}
const race=structuredClone(fixture);
race.riders=race.riders.filter(x=>x.no<=7);
race.lineup=[[1,7,5,3],[2,4],[6]];
race.riders.find(x=>x.no===1).style='逃';
race.riders.find(x=>x.no===2).style='両';
race.riders.find(x=>x.no===6).style='逃';
race.race_material={comments:[],lineup_conflicts:[]};
const topo=E.structure(race),lines=Object.fromEntries(topo.lines.map(x=>[x.id,x]));
const evalFeatures=(strongFront=true)=>(no,key)=>{
 const a=no===1,b=no===2;
 if(key==='ability')return a?(strongFront?.87:.35):b?.62:.65;
 if(key==='initiative')return a?(strongFront?.81:.22):b?.58:.57;
 if(key==='endurance')return a?.78:.6;
 if(key==='track')return .75;
 if(key==='position')return .62;
 if(key==='makuri'||key==='withdraw')return .62;
 return .60;
};
const run=(r,features,structure=topo,allLines=lines)=>{
 let seq=1;
 const pos=Positioning.create({
  r,lines:allLines,topology:structure,f:features,
  ev:(no,key)=>({no,key,value:features(no,key),basis:'synthetic pre-race'}),
  term:(s,axis,value,reason,features=[])=>s.terms.push({axis,value,reason,features}),
  event:(s,actor,action,reason)=>s.events.push({actor,action,reason}),
  move:(s,id,to)=>{s.order=s.order.filter(x=>x!==id);s.order.splice(to,0,id);},
  who:id=>id+'ライン',intentTerm:()=>{},allocate:()=>++seq,
  lineSupport:()=>.5,power:id=>features(allLines[id].head,'ability')
 });
 const s={id:1,order:['A','B','C'],burden:{A:0,B:0,C:0},events:[],terms:[],assumptions:[],used:[],attacks:[],detached:[],switches:{},scenes:[]};
 return {pos,states:pos.early(s)};
};
const strong=run(race,evalFeatures(true));
ok(strong.pos.formation('A').size===4&&strong.pos.formation('B').size===2&&strong.pos.formation('C').size===1,'recognizes four, two and solo as distinct formations');
ok(strong.pos.formation('A').continuity>strong.pos.formation('B').continuity,'additional followers create more potential tactical cover');
ok(strong.pos.formation('A').trackingRisk>strong.pos.formation('B').trackingRisk,'extra riders also create a tracking-continuity burden');
ok(strong.pos.matchup('A','B').frontCanDefend,'four-car strong leader can resist two-car earlier press');
ok(!strong.states.some(s=>s.positioning_steps?.[0]?.actor==='B'&&s.positioning_steps[0].action==='press'&&s.positioning_steps[0].response==='yield'),'unexplained short-line early lead does not gain unconditional consent');
ok(strong.states.some(s=>s.positioning_steps?.[0]?.actor==='B'&&s.positioning_steps[0].action==='press'&&s.positioning_steps[0].response==='resist'),'short line trying to press encounters a front resistance branch');
ok(strong.states.some(s=>s.positioning_steps?.[0]?.actor==='B'&&s.positioning_steps[0].action==='cut'&&s.positioning_steps[0].response==='yield'),'two-rider line may momentarily cut when front chooses to let it through');
ok(strong.pos.goal('A').formation.size===4&&strong.pos.goal('A').reason.includes('先頭の加速力はライン長で増えない'),'formation benefit is explicitly distinguished from raw rider power');
const weak=run(race,evalFeatures(false));
ok(!weak.pos.matchup('A','B').frontCanDefend,'weak four-car front does not gain an automatic ability to resist');
ok(weak.states.some(s=>s.positioning_steps?.[0]?.actor==='B'&&s.positioning_steps[0].action==='press'&&s.positioning_steps[0].response==='yield'),'stronger two-rider line may lead when front is weak');
const deliberate=structuredClone(race);
deliberate.race_material.comments=[{rider:deliberate.riders.find(x=>x.no===1).name,declaration:'一度引いて捲り返す',declaration_complete:true}];
const elected=run(deliberate,evalFeatures(true));
ok(elected.states.some(s=>s.positioning_steps?.[0]?.actor==='B'&&s.positioning_steps[0].action==='press'&&s.positioning_steps[0].response==='yield'),'explicit four-rider withdrawal makes a deliberate allowance possible');
const three=structuredClone(race);three.lineup=[[1,7,5],[2,4],[3,6]];
const t=E.structure(three),by=Object.fromEntries(t.lines.map(l=>[l.id,l]));
const triple=run(three,evalFeatures(true),t,by);
ok(triple.pos.formation('A').size===3&&triple.pos.matchup('A','B').frontCanDefend,'a strong three-rider train also has defended-lead options');
ok(triple.pos.formation('A').continuity>triple.pos.formation('B').continuity,'three-rider advantage is distinguishable from two-rider');
console.log('PASS LINE FORMATION MATCHUP '+checks+' checks');
