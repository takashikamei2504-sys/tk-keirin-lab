'use strict';
const assert=require('node:assert/strict');
const E=require('../../js/line/engine.js');
const Input=require('../../js/line/input.js');
const Positioning=require('../../js/line/positioning.js');
const sample=require('../../race_sample.json');
let checks=0;
function ok(value,msg){assert.ok(value,msg);checks++;}
const allPatterns=Positioning.PATTERNS;
ok(allPatterns.length===12,'twelve explicit positioning patterns');
ok(new Set(allPatterns.map(x=>x.id)).size===12,'pattern IDs unique');
ok(allPatterns.every(x=>x.goal&&x.action&&x.failure),'each pattern has a goal, move and failure');
const seven=structuredClone(sample);
seven.riders=seven.riders.slice(0,7);
seven.lineup=[[1,4,3],[5,2],[6,7]]; // Three active line leaders: 1 / 5 / 6
const topology=E.structure(seven),l=Object.fromEntries(topology.lines.map(x=>[x.id,x]));
const orders=Positioning.initialOrders(topology,'A');
ok(orders.length>=2,'alternative starting orders are evaluated');
ok(orders.every(o=>o.order[0]==='A'&&new Set(o.order).size===topology.lines.length),'every initial order preserves the roster');
const input=Input.prepare(seven),f=(no,key)=>input.features[no][key].value;
const evals=[],create=Positioning.create({
 r:seven,lines:l,topology,f,ev:(no,key)=>({no,key,value:f(no,key),basis:'発走前'}),
 term:(s,axis,value,reason,features=[])=>s.terms.push({axis,value,reason,features}),
 event:(s,actor,action,reason)=>s.events.push({actor,action,reason}),
 move:(s,id,to)=>{s.order=s.order.filter(x=>x!==id);s.order.splice(to,0,id);},
 who:id=>id+'ライン',intentTerm:()=>{},allocate:()=>100+(++checks),
 lineSupport:()=>.5,power:id=>f(l[id].head,'ability')
});
const base={
 id:1,order:['A','B','C'],burden:{A:0,B:0,C:0},events:[],terms:[],
 assumptions:[],used:[],attacks:[],detached:[],switches:{},scenes:[]
};
const candidates=create.early(base);
ok(candidates.length>5,'multiple first-move paths evaluated');
ok(candidates.some(x=>x.positioning_goals?.A?.scores?.lead>=0),'line intent scores are recorded');
ok(candidates.some(x=>x.positioning_steps?.length===2),'third-line sequential decision is possible');
ok(candidates.filter(x=>x.positioning_steps?.length).every(x=>x.positioning_steps.every(st=>st.pattern_label&&st.failure_condition)),'actions are associated with meaningful pattern knowledge');
const cut=candidates.find(x=>x.positioning_steps?.[0]?.actor==='B'&&x.positioning_steps?.[0]?.action==='cut'&&x.positioning_steps?.[0]?.response==='yield'&&x.positioning_steps?.length===2&&x.positioning_steps?.[1]?.actor==='C');
ok(cut,'a third line can take over following an initial cut');
assert.deepEqual(cut.order,['C','B','A']);checks++;
ok(cut.pendingCut===null,'third-line takeover resolves pending cut');
const rearFirst=candidates.filter(x=>x.positioning_steps?.[0]?.actor==='C'&&x.positioning_steps?.[0]?.action==='cut'&&x.positioning_steps?.[0]?.response==='yield');
ok(rearFirst.length>0,'three-way autonomous race explores rear-first rise');
const recut=candidates.find(x=>x.positioning_steps?.length===2&&x.positioning_steps?.map(st=>st.actor).join('-')==='C-B'&&x.order.join('-')==='B-C-A');
ok(recut,'rear C rise is followed by B reclaiming middle after overtaking C');
ok(recut.pendingCut==='B','B recut remains pending until the next line takes the lead');
const fullCycle=candidates.find(x=>x.positioning_steps?.length===3&&x.positioning_steps?.map(st=>st.actor).join('-')==='C-B-A'&&x.order.join('-')==='A-B-C');
ok(fullCycle,'rear C then middle B then front A creates a complete three-cut cycle');
ok(fullCycle.pendingCut===null,'front A lead retake resolves the pending middle cut');
assert.deepEqual(fullCycle.positioning_steps.map(x=>x.after),[['C','A','B'],['B','C','A'],['A','B','C']]);checks++;
ok(fullCycle.positioning_steps.every(x=>x.reason&&x.pattern_label),'three-cut cycle records each action with a rationale');
const rearResists=candidates.find(x=>x.positioning_steps?.length===2&&x.positioning_steps?.map(st=>st.actor).join('-')==='C-B'&&x.positioning_steps?.[1]?.response==='rear_resists');
ok(rearResists&&rearResists.order.join('-')==='C-A-B','rear C can resist B's counter-cut; B does not acquire good position');
const middleFirst=candidates.filter(x=>x.positioning_steps?.[0]?.actor==='B');
ok(middleFirst.length>0&&middleFirst.every(x=>x.terms.some(t=>t.reason.includes('中団')&&t.reason.includes('後方')&&t.value<0)),'unexplained middle-first paths are retained only as penalized alternatives');
const resisted=candidates.filter(x=>x.positioning_steps?.[0]?.response==='resist');
ok(resisted.length>0,'front-line resistance is explored');
ok(resisted.every(x=>x.order.join('-')==='A-B-C'),'resisted attacker is not automatically granted middle');
ok(resisted.some(x=>x.events.some(e=>e.action==='withdraw')),'failed rise is explicitly withdrawn');
ok(candidates.every(x=>new Set(x.order).size===3&&x.order.includes('A')&&x.order.includes('B')&&x.order.includes('C')),'riders never disappear in intermediate decisions');
ok(new Set(candidates.map(x=>x.id)).size===candidates.length,'unique branch IDs for all reactions');
ok(candidates.filter(x=>x.positioning_steps?.length).every(x=>x.positioning_steps.every((step,i)=>step.sequence===i+1&&step.before&&step.after&&step.goal)),'all actions have ordered before/after, intent and reason');
assert.deepEqual(base.order,['A','B','C']);checks++;
const out=E.build(seven,{},{width:128,traceCandidates:true});
ok(out.version==='LAB_LINE_ENGINE_V1.3.1','version provenance updated');
ok(out.main.scenes.length===6,'six scenes preserved');
ok(out.candidate_evaluations.some(x=>x.scenes?.[1]?.positioning_steps?.length>1),'integrated simulation retains chained positioning');
ok([out.main,...out.alternatives].every(x=>x.scenes?.[0]?.start_plan?.initial_order.length===3),'initial-order provenance recorded');
ok([out.main,...out.alternatives].every(x=>x.scenes?.[1]?.positioning_goals?.A),'decision goals visible in redboard scene');
ok(out.candidate_evaluations.every(x=>x.scenes?.every(s=>new Set(s.order).size===7)),'all riders retained in six phases');
console.log('PASS LAB LINE POSITIONING '+checks+' checks');
