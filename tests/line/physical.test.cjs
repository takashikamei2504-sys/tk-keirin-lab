'use strict';
const assert=require('node:assert/strict');
const Physical=require('../../js/line/physical.js');
const Effort=require('../../js/line/effort.js');
const Select=require('../../js/line/selection.js');
const E=require('../../js/line/engine.js');
const sample=require('../../race_sample.json');
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++};
const seq=(before,after,actor)=>({before,after,actor,action:'cut'});
const standard={events:[],positioning_steps:[
 seq(['A','B','C'],['C','A','B'],'C'),
 seq(['C','A','B'],['B','C','A'],'B'),
 seq(['B','C','A'],['A','B','C'],'A')]};
ok(Physical.phase(standard,{},1).impossible.length===0,'three cuts C-B-A fit the normalized redboard window');
const broken=structuredClone(standard);broken.positioning_steps[1].before=['A','C','B'];
ok(Physical.phase(broken,{},1).impossible.some(x=>x.includes('連続性')),'noncontiguous positional changes rejected');
const overbooked={events:[],positioning_steps:Array.from({length:13},()=>seq(['A','B','C'],['A','B','C'],'C'))};
ok(Physical.phase(overbooked,{},1).impossible.some(x=>x.includes('移動容量')),'too many actions in one phase rejected');
ok(Physical.phase({events:[{actor:'C',action:'pass_middle'}]},{outside:null},3).impossible.length>0,'no middle pass without earlier outside acceleration');
const effort=Effort.initial(['A','B','C']);
const state={order:['B','C','A'],outside:{id:'A',from:2,started:2},scenes:[{},{},{}],effort};
const f=(id,key)=>key==='sprint'?.78:.65;
ok(Physical.middlePassOpportunity(state,'A','C',f).allowed,'outside progression is a conditional middle-pass opportunity');
ok(!Physical.middlePassOpportunity({...state,outside:{...state.outside,started:3}},'A','C',f).allowed,'same-phase instant pass rejected');
ok(!Physical.middlePassOpportunity({...state,order:['B','A','C']},'A','C',f).allowed,'wrong relative position rejected');
const ledger={effort:Effort.initial(['A'])};
const first=Effort.charge(ledger,'A','press'),repeat=Effort.charge(ledger,'A','resist');
ok(repeat.repeat>0&&ledger.effort.A.surges===2,'repeat acceleration increases cost');
ok(Effort.reserve(ledger,'A',.5)<Effort.budget(.5),'remaining relative effort declines');
const out=E.build(sample,{},{width:96,traceCandidates:true});
ok(out.version==='LAB_LINE_ENGINE_V1.3.7','new model is versioned');
ok(out.main.scenes.slice(0,5).every(x=>x.physical?.impossible?.length===0),'main hypothesis has no hard movement conflicts');
ok(out.candidate_evaluations.every(x=>x.audit.passed&&x.audit.physical.passed),'only physically valid candidates survive');
ok(out.decision.physical_gate.generated>=out.decision.physical_gate.eligible,'preselection feasibility gate recorded');
const invalid=structuredClone(out.main),valid=structuredClone(out.main);
invalid.id=900001;invalid.audit={passed:false,physical:{passed:false}};valid.id=900002;valid.audit={passed:true,physical:{passed:true}};
ok(Select.select([invalid,valid]).main.id===valid.id,'high-scoring invalid hypothesis cannot win');
for(let i=1;i<out.main.scenes.length;i++){
 const after=out.main.scenes[i].effort,before=out.main.scenes[i-1].effort;
 for(const [id,e] of Object.entries(after))ok(e.spent>=before[id].spent,'line effort is irreversible across phases');
}
console.log('PASS physical and unified effort '+checks+' checks');
