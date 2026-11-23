'use strict';
const assert=require('node:assert/strict'),O=require('../../js/mrt/odds-reallocate.js');
const now=Date.parse('2026-11-23T01:00:00Z');
const tickets=[
 {cars:[1,2,3],yen:4000,allocation_score:0.09,scenario_id:'B1'},
 {cars:[2,1,3],yen:3500,allocation_score:0.055,scenario_id:'B2'},
 {cars:[3,2,1],yen:2500,allocation_score:0.03,scenario_id:'B3'}
];
const output={tickets,budget_yen:10000,race_id:'202611232601'};
const payload={race_id:output.race_id,identity_sha256:'identity',model_sha256:'model',
 sales_close_at:'2026-11-23T01:15:00Z'};
const quote={schema:'tk-mrt-odds-quote/v1',race_id:output.race_id,identity_sha256:'identity',model_sha256:'model',
 condition:'auto',market:'trifecta',state:'live',reference_only:true,
 source_url:'https://www.winticket.jp/keirin/example/racecard/2026112301/1/1',
 published_at:'2026-11-23T00:59:45Z',captured_at:'2026-11-23T00:59:55Z',
 sales_close_at:'2026-11-23T01:12:00Z',
 odds:{'1-2-3':3.8,'2-1-3':19.4,'3-2-1':65.8}};
const plan=O.build(payload,output,quote,null,'leader',now);
assert.equal(plan.baseline.stake,300);assert.equal(plan.cap3000.stake,3000);
assert.equal(plan.cap5000.stake,5000);
assert.equal(plan.cap5000.tickets.reduce((a,b)=>a+b.yen,0),5000);
assert.equal(plan.cap5000.tickets.length,3);
assert.equal(plan.calibrated_probability,false);
assert.equal(plan.status,'research_only');
assert(plan.cap5000.tickets.every(t=>t.yen%100===0&&t.yen>=100&&t.yen<=1700));
assert.equal(output.tickets[0].yen,4000);
assert.throws(()=>O.check(payload,output,{...quote,odds:{'1-2-3':3.8}},null,'leader',now),/未取得/);
assert.throws(()=>O.check(payload,output,{...quote,identity_sha256:'different'},null,'leader',now),/不一致/);
assert.throws(()=>O.check(payload,output,{...quote,condition:'1-2:leader'},null,'leader',now),/Bライン/);
assert.throws(()=>O.check(payload,output,{...quote,published_at:'2026-11-23T00:54:00Z'},null,'leader',now),/古い/);
assert.throws(()=>O.check(payload,output,quote,null,'leader',Date.parse(quote.sales_close_at)),/締切/);
assert.throws(()=>O.allocate(output,quote,100),/最低100円/);
assert.throws(()=>O.allocate(output,quote,5100),/上限/);
const t2={...quote,condition:'1-2:leader'};
assert.equal(O.build(payload,output,t2,'1-2','leader',now).condition,'1-2:leader');
console.log('PASS MRT odds planner: quote validation, freshness, identity, 3k/5k cap, research-only and immutable forecast');
