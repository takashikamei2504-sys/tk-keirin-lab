const a=require('node:assert/strict'),R=require('../js/line-reactions.js'),B=require('../js/story-brain.js'),F=require('./formation-fixtures.cjs');
const s={leader:1,front:1,attacker:4,homeRider:4,homeResult:'parallel',order:[1,2,3,4,5,6,7],outside:[4],energy:Object.fromEntries(F.race.riders.map(r=>[r.no,.1])),connected:Object.fromEntries(F.race.riders.map(r=>[r.no,true])),reactionLog:[]};
const move=(s,moving,target)=>{const group=s.order.filter(n=>moving.includes(n)),rest=s.order.filter(n=>!moving.includes(n));s.order=[...rest.slice(0,target),...group,...rest.slice(target)];};
const service=R.build(F.race),choices=service.laterOptions(s,'home');a.equal(choices.rows.length,F.race.lineup.length);a.ok(choices.choices.some(c=>c.key==='wait'));a.ok(choices.choices.some(c=>c.actor===6));
const counter=structuredClone(s);service.applyLater(counter,6,'home',move);a.deepEqual(counter.order,[1,2,3,6,7,4,5]);a.ok(counter.energy[6]>s.energy[6]);a.equal(counter.reactionLog[0].actor,6);a.ok(!service.laterOptions(counter,'back').choices.some(c=>c.actor===6),'cannot pass the controlling front line for free');
const retreat=structuredClone(s);service.applyOutside(retreat,{actor:4,key:'retreat'},'back',move);a.deepEqual(retreat.order,[1,2,3,6,7,4,5]);a.ok(!retreat.outside.includes(4));a.equal(retreat.recovery[4],1);
let independent=false;
for(const c of require('./engine-cases.cjs')){const out=B.build(c.race,c.pack);a.ok(out.diagnostics.search_trace.some(x=>x.phase==='home-line-response'));a.ok(out.diagnostics.search_trace.some(x=>x.phase==='back-individual-follow'));a.ok(out.diagnostics.search_trace.some(x=>x.phase==='inside-opening'));
 for(const story of out.narratives){for(const sc of story.scenes.slice(0,5)){a.equal(sc.lineReactions.rows.length,c.race.lineup.length);a.equal(new Set(sc.order).size,c.race.riders.length);}
 const corner=story.scenes[4].tactical;if(corner.defense==='block'&&!corner.openInside)independent=true;if(corner.innerRider)a.ok(corner.openInside);
 }
}
a.ok(independent,'a block does not force an open inside lane in every path');
console.log('PASS later counter/wait causality, grouped retreat, recovery record, individual follow and independent inside opening');
