'use strict';
// Independent structural diagnosis only. Does not alter prediction logic or save predictions.
// These are controlled fixtures based on race_sample.json, NOT actual Yokkaichi race inputs.
const fs=require('node:fs');
const E=require('../js/line/engine.js');
const Pos=require('../js/line/positioning.js');
const base=JSON.parse(fs.readFileSync('race_sample.json','utf8'));
base.lineup=[[2,8],[1,4],[5,6],[3],[7],[9]];
const clone=x=>JSON.parse(JSON.stringify(x));
function test(label,change){
 const r=clone(base);if(change)change(r);
 const topology=E.structure(r),starts=E.frontChoices(r,topology,[]);
 const startsDetailed=starts.choices.flatMap(c=>Pos.initialOrders(topology,c.line.id).map(x=>x.order));
 const expected=['A','D','B','F','C','E'];
 const out=E.build(r,{}, {width:96,traceCandidates:true});
 const e=out.candidate_evaluations||[],phases=out.main.scenes||[];
 const count=action=>e.filter(x=>(x.scenes||[]).some(s=>(s.events||[]).some(z=>z.action===action))).length;
 const pairCounts={};for(const x of e){const k=x.pair.join('-');pairCounts[k]=(pairCounts[k]||0)+1;}
 const report={
  label,model:out.provenance.model.model_id,lines:topology.lines.map(l=>({id:l.id,members:l.members})),
  initialCandidates:startsDetailed.length,expectedInitialOrder:expected,
  expectedInitialOrderConsidered:startsDetailed.some(x=>x.join('-')===expected.join('-')),
  search:{...out.search,candidateCount:e.length},
  eventCandidateCounts:Object.fromEntries(['resist','yield','cut','kamashi','long','short','counter','use','block','stalled','pass_middle','position'].map(x=>[x,count(x)])),
  main:{pair:out.main.finish.pair,mode:out.main.finish.mode,axis:out.decision.label,order:phases[0].groups.map(g=>({id:g.id,members:g.members})),phases:phases.map(s=>({phase:s.phase,control:s.control,actions:s.events.filter(e=>!['wait','front','finish'].includes(e.action)).map(e=>({actor:e.actor,action:e.action,outcome:e.outcome||null})),positioningSteps:(s.positioning_steps||[]).map(z=>({actor:z.actor,action:z.action,response:z.response}))})),effort:out.main.effort},
  alternatives:out.alternatives.slice(0,5).map(x=>({pair:x.finish.pair,mode:x.finish.mode,hasResist:x.scenes.some(s=>s.events.some(e=>e.action==='resist'))})),
  pairCounts:Object.entries(pairCounts).sort((a,b)=>b[1]-a[1]).slice(0,8)
 };
 console.log('LINE_COGNITION_AUDIT '+JSON.stringify(report));
 return report;
}
const results=[];
results.push(test('baseline_six_groups'));
results.push(test('strong_other_leader',r=>{const x=r.riders.find(x=>x.no===5);x.score=123.7;x.style='逃';x.b=16;x.wins=11;x.seconds=3;x.outs=7;}));
results.push(test('strong_middle_leader',r=>{const x=r.riders.find(x=>x.no===1);x.score=124.0;x.b=16;x.wins=12;x.seconds=3;x.outs=7;}));
console.log('LINE_COGNITION_DIFF '+JSON.stringify({pairs:results.map(x=>({label:x.label,pair:x.main.pair,mode:x.main.mode,mainActions:x.main.phases.map(p=>p.actions.map(a=>a.action))}))}));
