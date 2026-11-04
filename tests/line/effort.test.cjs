'use strict';
const assert=require('node:assert/strict');
const Effort=require('../../js/line/effort.js');
const Positioning=require('../../js/line/positioning.js');
const E=require('../../js/line/engine.js');
const sample=require('../../race_sample.json');
let checks=0;const ok=(v,msg)=>{assert.ok(v,msg);checks++;};
const initial=Effort.initial(['A','B','C']);
const efforts=structuredClone(initial);
const cut=Effort.charge({effort:efforts},'C','cut',{phase:'赤板'});
const repeat=Effort.charge({effort:efforts},'C','kamashi',{phase:'最終ホーム'});
ok(repeat.cost>cut.cost,'repeated acceleration becomes more expensive');
ok(efforts.C.surges===2&&efforts.C.spent>cut.spent,'effort accumulates');
const single={effort:Effort.initial(['C'])},follow={effort:Effort.initial(['C'])};
const self=Effort.charge(single,'C','press',{phase:'最終ホーム'});
Effort.charge(follow,'C','follow',{drafted:true,phase:'最終ホーム'});
const caught=Effort.charge(follow,'C','kamashi',{drafted:true,phase:'最終バック'});
ok(follow.effort.C.usedDraft===2&&caught.cost<self.cost+.12,'drafted acceleration saves relative effort');
const direct={effort:Effort.initial(['C'])},assisted={effort:Effort.initial(['C'])};
Effort.charge(direct,'C','cut');Effort.charge(direct,'C','press');
Effort.charge(assisted,'C','cut');Effort.charge(assisted,'C','follow',{drafted:true});
Effort.charge(assisted,'C','kamashi',{drafted:true});
ok(assisted.effort.C.spent<direct.effort.C.spent,'using the rear attack consumes less than independently recutting twice');
const topology={lines:[{id:'A',head:1,members:[1,5,6],length:3},{id:'B',head:2,members:[2,7],length:2},{id:'C',head:3,members:[3,4],length:2}],active:['A','B','C']};
const f=(no,key)=>key==='track'?.7:key==='kamashi'?.75:key==='sprint'?.76:key==='initiative'?.65:key==='endurance'?.65:.6;
const model=Positioning.create({
 r:{riders:sample.riders},lines:Object.fromEntries(topology.lines.map(l=>[l.id,l])),topology,f,
 ev:(no,key)=>({no,key,value:f(no,key),basis:'synthetic only'}),power:()=>.65,
 term:(s,axis,value,reason)=>s.terms.push({axis,value,reason}),
 event:(s,actor,action,reason)=>{const drafted=action==='draft'||(action==='kamashi'&&s.events.some(e=>e.actor===actor&&e.action==='draft'));Effort.charge(s,actor,action,{drafted});s.events.push({actor,action,reason});},
 who:id=>id+'ライン',move:(s,id,to)=>{s.order=s.order.filter(x=>x!==id);s.order.splice(to,0,id);},
 allocate:()=>100,intentTerm:()=>{},lineSupport:()=>0,
 effortCharge:Effort.charge
});
const source={id:1,order:['B','C','A'],outside:{id:'A',from:2,anchor:'B',kind:'kamashi',started:2},secondary:null,
 used:['A'],burden:{A:1,B:0,C:0},effort:Effort.initial(['A','B','C']),
 scenes:[{},{},{}],events:[],terms:[],attacks:[{id:'A',kind:'kamashi',from:2,phase:2}],assumptions:[]};
const possible=model.slipstreamCounter(source);
ok(possible.length===1,'rearmost A moving outside can trigger middle C to follow and counter');
const result=possible[0];
assert.deepEqual(result.events.map(e=>e.action),['pass_middle','draft','kamashi']);checks++;
ok(result.outside.id==='A'&&result.outside.from===1&&result.secondary.id==='C'&&result.secondary.kind==='kamashi',
 'A first passes C, then C accelerates after drafting A');
ok(result.effort.C.usedDraft===2&&result.effort.C.surges===1&&result.effort.C.spent>0,'C saves energy in slipstream then spends on one surge');
assert.equal(source.secondary,null);checks++;
ok(model.slipstreamCounter({...source,outside:null}).length===0,'C cannot counter from slipstream if A did not move');
ok(model.slipstreamCounter({...source,order:['B','A','C']}).length===0,'C cannot follow A from an impossible relative position');
const out=E.build(sample,{},{width:128,traceCandidates:true});
ok(out.version==='LAB_LINE_ENGINE_V1.3.5','version reflects effort model');
ok(out.main.scenes.every(sc=>sc.effort&&sc.effort.A),'effort provenance persists across six scenes');
ok(out.candidate_evaluations.every(c=>c.effort),'all final candidates retain finite-effort histories');
const State=require('../../js/line/state.js');
const lineMap=Object.fromEntries(out.topology.lines.map(l=>[l.id,l]));
const wrong=structuredClone(out.main);
wrong.scenes[3].events.unshift({actor:'C',action:'draft',reason:'hypothetical unsafe tracking'});
ok(State.audit(wrong,out.input.race,lineMap).failures.some(x=>x.includes('因果順序')),'cannot draft without an observed earlier move by another line');
const regressed=structuredClone(out.main);
const id=out.topology.lines[0].id;
regressed.scenes[1].effort[id].spent+=10;
ok(State.audit(regressed,out.input.race,lineMap).failures.some(x=>x.includes('履歴が逆行')),'effort cannot increase and then reset');
console.log('PASS LINE EFFORT AND SLIPSTREAM '+checks+' checks');
