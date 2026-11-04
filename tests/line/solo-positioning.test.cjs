'use strict';
const assert=require('node:assert/strict');
const E=require('../../js/line/engine.js');
const Positioning=require('../../js/line/positioning.js');
const sample=require('../../race_sample.json');
let checks=0;const ok=(v,msg)=>{assert.ok(v,msg);checks++};
const r=structuredClone(sample);
r.date='2026-11-04';r.venue='豊橋';r.race_no=12;r.start='20:30';
r.riders=r.riders.filter(x=>x.no<=7);
const riders={
 1:['深谷知広','逃',117.17,10],2:['伊藤旭','両',109.68,4],
 3:['川津悠揮','追',107.47,0],4:['福島武士','追',104.33,0],
 5:['雨谷一樹','両',110.11,0],6:['田中大我','逃',102.95,10],
 7:['吉澤純平','両',113.23,0]
};
for(const rider of r.riders){const x=riders[rider.no];rider.name=x[0];rider.style=x[1];rider.score=x[2];rider.b=x[3];}
r.lineup=[[1,7,5,3],[2,4],[6]];
r.race_material={comments:[{rider:'田中大我',declaration:'自力。',declaration_complete:true}],lineup_conflicts:[]};
const topology=E.structure(r),lines=Object.fromEntries(topology.lines.map(l=>[l.id,l]));
ok(lines.A.length===4&&lines.B.length===2&&lines.C.length===1,'Toyohashi shape 4-2-1 preserved');
ok(!E.frontChoices(r,topology,[]).choices.some(x=>x.line.id==='C'),'solo S front is not inferred from ordinary self-powered comment');
const makePos=(race)=>Positioning.create({
 r:race,lines,topology,f:(no,key)=>key==='track'||key==='position'?.64:key==='initiative'?.63:.61,
 ev:(no,key)=>({no,key,value:.61,basis:'synthetic pre-race fixture',sources:[]}),
 term:(s,axis,value,reason,features=[])=>s.terms.push({axis,value,reason,features}),
 event:(s,actor,action,reason)=>s.events.push({actor,action,reason}),
 move:(s,id,to)=>{s.order=s.order.filter(x=>x!==id);s.order.splice(to,0,id);},
 who:id=>id+'ライン',intentTerm:()=>{},allocate:()=>++seq,lineSupport:()=>.5,power:()=>.60
});
let seq=1;const pos=makePos(r);
ok(!pos.soloLeadSupported('C'),'self-powered statement alone is not an explicit solo lead plan');
ok(pos.soloAgainstLongLine('C'),'the four-rider threat is recognized');
const base={id:1,order:['B','C','A'],burden:{A:0,B:0,C:0},events:[],terms:[],assumptions:[],used:[],attacks:[],detached:[],switches:{},scenes:[]};
const early=pos.early(base);
ok(!early.some(x=>x.positioning_steps?.some(t=>t.actor==='C'&&t.after?.[0]==='C')),'solo does not irrationally recut into lead');
ok(early.some(x=>x.order.join('-')==='A-C-B'&&x.positioning_steps?.some(st=>st.actor==='C'&&st.action==='position'&&st.response==='follow_long_line')),'solo may use the long line movement to take middle');
const pre=E.build(r,{},{width:128,traceCandidates:true});
ok(pre.version==='LAB_LINE_ENGINE_V1.3.5','new version');
ok(pre.main.scenes[2].control!=='C','main cannot put the unsupported solo in the lead at final home');
ok(pre.candidate_evaluations.every(x=>x.scenes[2].control!=='C'),'unsupportable solo-lead paths are excluded before final selection');
const declared=structuredClone(r);declared.race_material.comments=[{rider:'田中大我',declaration:'単騎でも先行して主導権を取る',declaration_complete:true}];
const deliberate=makePos(declared);
ok(deliberate.soloLeadSupported('C'),'explicit solo lead intent is a narrow exception');
ok(deliberate.early(base).some(x=>x.positioning_steps?.[0]?.actor==='C'&&x.positioning_steps[0].action==='press'),'a truly explicit solo attack is still explored');
console.log('PASS solo positioning 4-2-1 '+checks+' checks');
