'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Input=require('../js/line/input.js');
const Ex=require('../js/b-axis/ex-data.js');
const Context=require('../js/b-axis/ex-context.js');
const Interaction=require('../js/b-axis/interactions.js');
const B=require('../js/b-axis/engine.js');
const root=path.join(__dirname,'..');
const stored=JSON.parse(fs.readFileSync(path.join(root,'data/lab_history/2026-11-08/p-285d0fbf519331a2e7b754f5e1f170800bb5e59136242d5baadd866d73b0c059.json'),'utf8'));
const input=Input.prepare(stored.input,{},Date.parse(stored.saved_at));
const data=JSON.parse(fs.readFileSync(path.join(root,'data/b_axis_ex_context.json'),'utf8'));
assert.equal(B.VERSION,'LAB_B_AXIS_V0.6.0');
assert.equal(data.schema,'tk-b-axis-ex-context-history/v1');
assert.equal(data.summary.nRaces,2091);
assert.equal(data.summary.weatherRows,0);
assert.equal(data.training_end,'2026-11-07');
assert.equal(data.provenance.actual_b_available,false);
input.race.ex_context={track_length:400,weather:null,weather_source_verified:false};
input.bAxisExContext=data;
const k=input.race.riders.find(r=>r.no===5);
assert.equal(Context.idOf(k),'14838');
assert.equal(Context.position(input.race,k),'thirdPlus');
assert.equal(Context.keys(input.race,k).bank_length,'400');
assert.equal(Context.keys(input.race,k).weather,null);
assert.equal(Context.timeBand('23:50'),'midnight');
assert.equal(Context.timeBand('09:59'),'morning');
assert.equal(Context.roundType('Ｓ級 準決勝'),'semifinal');
assert.equal(Context.roundType('Ａ級 決勝'),'final');
assert.equal(Context.bankLength(333),'333');
assert.equal(Context.bankLength(500),'500');
assert.equal(Context.asOfJapanDate(input),'2026-11-08');
assert.equal(Context.allowed(data,input.race,input),true);
const archived=Context.snapshot(input,k);
assert.equal(archived.valid,true);
assert(archived.contributions.some(x=>x.axis==='bank_length'));
assert(!archived.contributions.some(x=>x.axis==='weather'));
assert(archived.contributions.every(x=>x.origin==='PUBLIC_RESULT_DERIVED'));
const premature=structuredClone(input);
premature.as_of='2026-11-07T10:00:00Z'; // 19:00 JST, archive contains later Nov7 results
assert.equal(Context.allowed(data,premature.race,premature),false);
assert.equal(Context.snapshot(premature,k).contributions.length,0);
const prevRace=structuredClone(input);
prevRace.race.date='2026-11-07';
assert.equal(Context.allowed(data,prevRace.race,prevRace),false);
const official=structuredClone(input);
official.race.ex_context={track_length:400,weather:'雨',weather_source_verified:true};
const labels=Context.keys(official.race,k);
const conditions=Object.fromEntries(Context.AXES.map(x=>[x,{[labels[x]]:{opportunities:20,wins:7,top3:12}}]));
const profile=(id,values,contextual)=>({source_url:'https://www.winticket.jp/keirin/cyclist/0'+id,
 published_at:'2026-11-06T04:00:00Z',collected_at:'2026-11-07T04:00:00Z',
 period_end:'2026-11-06',metrics:values,contextual});
const challenger=official.race.riders.find(r=>r.no===3),defender=official.race.riders.find(r=>r.no===2);
official.bAxisEx={schema:'tk-b-axis-ex-observations/v1',riders:{
 [Ex.identity(k)]:profile(Ex.identity(k),{
 chigiri:{events:2,opportunities:10},chigirarare:{events:3,opportunities:20},
 kamashi:{events:5,opportunities:7},tsuppari:{events:8,opportunities:10},
 tobitsuki:{events:2,opportunities:6},seri:{events:9,opportunities:13}},conditions),
 [Ex.identity(challenger)]:profile(Ex.identity(challenger),{tobitsuki:{events:9,opportunities:12}},null),
 [Ex.identity(defender)]:profile(Ex.identity(defender),{seri:{events:7,opportunities:12}},null)
}};
for(const metric of ['chigiri','chigirarare','kamashi','tsuppari','tobitsuki','seri']){
 assert(Ex.evidence(official,k,metric,{asOf:official.as_of}),'EX '+metric+' should have numerator and denominator');
}
for(const axis of Context.AXES){
 const measured=Ex.contextual(official,k,axis,labels[axis],{asOf:official.as_of});
 assert.equal(measured.opportunities,20,axis);
 assert.equal(measured.wins,7,axis);
}
const ctx=Context.snapshot(official,k);
assert.equal(ctx.official.length,5);
assert(ctx.contributions.every(x=>x.origin==='WINTICKET_EX'));
assert(ctx.contributions.some(x=>x.axis==='weather'));
const altered=structuredClone(official);altered.bAxisEx.riders[Ex.identity(k)].collected_at='2026-11-09T00:00:00Z';
assert.equal(Ex.contextual(altered,k,'weather','rain',{asOf:altered.as_of}),null);
const faulty=structuredClone(official);faulty.bAxisEx.riders[Ex.identity(k)].contextual.weather.rain.top3=30;
assert.equal(Ex.contextual(faulty,k,'weather','rain',{asOf:faulty.as_of}),null);
const snapshot={bNo:1,line:[1,2],states:[
 {no:1,line:[1,2],lineIndex:0,role:'B先頭',gap:0,track:'先頭',speed:.65,closing:.45,remaining:.55,ability:.55},
 {no:2,line:[1,2],lineIndex:1,role:'B番手',gap:.62,track:'追走',speed:.52,closing:.52,remaining:.74,ability:.61},
 {no:3,line:[3,4],lineIndex:0,role:'別線自力・仕掛け候補',gap:1.35,track:'外並走',attack:true,reachable:true,speed:.77,closing:.72,remaining:.71,ability:.72}
]};
const contests=Interaction.review(official,snapshot);
assert.equal(contests.markerContests.length,1);
assert.equal(contests.markerContests[0].attackerMeasured.events,9);
assert.equal(contests.markerContests[0].defenderMeasured.events,7);
const detached=structuredClone(snapshot);detached.states[1].track='追走離れ気味';
assert.equal(Interaction.review(official,detached).markerContests.length,0);
const prediction=B.build(official,{bNo:3,tactic:'surge',limit:10});
assert(prediction.tickets.length>0);
assert(prediction.tickets.every(t=>t.trio.length===3));
assert.equal(prediction.b.bNo,3);
// This test only uses artificial EX counts to test ingestion. Real file remains empty.
const original=JSON.parse(fs.readFileSync(path.join(root,'data/b_axis_ex_observations.json'),'utf8'));
assert.deepEqual(original.riders,{});
console.log('B-AXIS 11-category EX source checks and public context data: passed');
