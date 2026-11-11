'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Gate=require('../js/coverage-gate/logic.js');
const Reporter=require('../scripts/coverage-gate-report.cjs');
const date='2026-11-11';
const time='10:00';
const cutoff=date+'T01:00:00.000Z';
const saved_at=date+'T00:30:00.000Z';
const key='1-2-3';
const entry={race_id:date+':試験場:1',race:{date,venue:'試験場',number:1,start:time},
  saved_at,cutoff,model:'test-v1',candidates:[key,'2-3-4','3-4-5','2-3-5']};
const outcome={race_id:entry.race_id,race:{start:time,riders:Array.from({length:7},(_,i)=>({no:i+1}))},
  combos:[{key,payout:4800}],source_updated_at:date+'T01:10:00Z',
  collected_at:date+'T01:11:00Z'};
const race=Gate.makeRace(entry,outcome,{cars:7,category:'チャレンジ_7'});
assert.equal(race.status,'evaluated');
assert.equal(race.heads,3);
assert.equal(race.stake,400);
assert.equal(race.payout,4800);
assert.equal(race.grade,'チャレンジ');
assert.equal(Gate.gate(race,Gate.FIXED).pass,true);
assert.equal(Gate.gate({...race,cars:9},Gate.FIXED).pass,false);
assert.deepEqual(Gate.gate({...race,heads:6},Gate.FIXED).reasons,['1着候補が6車']);
assert.equal(Gate.makeRace({...entry,saved_at:cutoff},outcome,{cars:7}),null);
assert.equal(Gate.makeRace({...entry,candidates:[key,key]},outcome,{cars:7}),null);
assert.equal(Gate.makeRace({...entry,candidates:['1-1-3']},outcome,{cars:7}),null);
assert.equal(Gate.makeRace(entry,{...outcome,source_updated_at:cutoff},{cars:7}).status,'unverified');
assert.equal(Gate.makeRace(entry,null,{cars:7}).status,'pending');
const nine={...race,race_id:'nine',cars:9,hit:false,payout:0,stake:400};
const wide={...race,race_id:'wide',heads:6,hit:false,payout:0,stake:400};
const summary=Gate.analyze([race,nine,wide],Gate.FIXED);
assert.equal(summary.all.races,3);
assert.equal(summary.passing.races,1);
assert.equal(summary.skippedCount,2);
assert.equal(summary.passing.roi,12);
assert.equal(summary.skipped.net,-800);
assert.equal(summary.passing.trimmed,0);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coverage-gate-'));
function write(rel,value) {
  const p=path.join(dir,rel);fs.mkdirSync(path.dirname(p),{recursive:true});
  fs.writeFileSync(p,JSON.stringify(value)+'\n');
}
try {
  const file='a'.repeat(64)+'.json';
  const identity=Array.from({length:7},(_,i)=>[i+1,String(i+100),'選手'+(i+1)]);
  write('roi/forecasts/'+date+'/index.json',{date,model:'test-v1',rows:[{...entry,file}]});
  write('roi/forecasts/'+date+'/'+file,{...entry,model:{model_id:'test-v1'},identity,comparison:{coverage:entry.candidates}});
  write('lab_history/'+date+'/results.json',{date,results:[{...outcome,identity}]});
  write('routed_history/'+date+'/coverage.json',{date,races:[{race_id:entry.race_id,category:'チャレンジ_7',cars:7}]});
  const report=Reporter.build(dir);
  assert.equal(report.races.length,1);
  assert.equal(report.races[0].status,'evaluated');
  assert.equal(report.summary.all.passing.roi,12);
  assert.equal(report.summary.prospective.passing.races,0);
  assert.equal(report.policy.start,'2026-11-13');
  assert.deepEqual(report.errors,[]);
  assert.equal(Reporter.save(path.join(dir,'output.json'),report),true);
  assert.equal(Reporter.save(path.join(dir,'output.json'),report),false);
  write('lab_history/'+date+'/results.json',{date,results:[{...outcome,identity:[...identity].reverse()}]});
  const tampered=Reporter.build(dir);
  assert.equal(tampered.races[0].status,'unverified');
  assert.equal(tampered.summary.all.passing.races,0);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
console.log('COVERAGE GATE validation: time freeze, skip rules, identity, no-leakage, report and idempotency OK');
