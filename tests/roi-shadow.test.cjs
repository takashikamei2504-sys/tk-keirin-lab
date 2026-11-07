'use strict';

const assert = require('node:assert/strict');
const Shadow = require('../js/roi/shadow.cjs');
const Report = require('../scripts/roi-shadow-report.cjs');
const Legacy = require('../js/results-audit.js');

const riders = [1,2,3,4,5,6,7].map((no,i)=>({no,name:String(no),score:[90,94,89,88,83,82,81][i],style:no===4?'両':'追'}));
const input = {riders,lineup:[[1,2,3],[4,5],[6],[7]],date:'2026-11-07',venue:'試験',race_no:1,start:'15:00'};
const keys = ['2-1-3','1-2-4','2-1-4','1-2-3','4-2-1','1-2-5'];
const chosen = keys.map((key,i)=>({key,trio:key.split('-').map(Number),group:i===4?'alternative':'main'}));
const lab = {input,chosen,race_id:Legacy.raceKey(input),identity:Legacy.identity(input)};
const scenes = Array.from({length:6},()=>({}));
scenes[3] = {positions:{4:{ordinal:2,band:'outside'}}};
scenes[4] = {positions:{1:{ordinal:3,band:'inner'}},connected:{1:true}};
const path = {id:7,score:1,scenes,audit:{passed:true,physical:{passed:true}},
  finish:{pair:[2,4],thirds:[{no:1}]}};
const line = {out:{main:path}};
const decision = Shadow.build(lab,line);
assert.deepEqual(decision.core,keys.slice(0,4));
assert.deepEqual(decision.full,keys);
assert.equal(decision.main,'1-2-5');
assert.equal(decision.mixed.ticket,'2-4-1');
assert.equal(decision.mixed.evidence.back_position,3);
assert.equal(Shadow.build({...lab,chosen:[...chosen.slice(0,3),{key:'2-4-1',trio:[2,4,1]}]},line).mixed.reason,'already_in_core');
assert.equal(Shadow.build({...lab,input:{...input,lineup:[[1,2,3],[4,5],[6,7]]}},line).mixed.reason,'outside_scope');
assert.equal(Shadow.build(lab,{out:{main:{...path,audit:{passed:true,physical:{passed:false}}}}}).mixed.reason,'no_supported_path');
const displaced = scenes.map((s,i)=>i===3 ? {positions:{4:{ordinal:4,band:'outside'}}} : s);
assert.equal(Shadow.build(lab,{out:{main:{...path,scenes:displaced}}}).mixed.reason,'no_supported_path');

const result = {race_id:lab.race_id,race:input,identity:lab.identity,
  source_updated_at:'2026-11-07T06:01:00Z',collected_at:'2026-11-07T06:02:00Z',
  combos:[{key:'2-4-1',trio:[2,4,1],payout:7500}]};
const group = Report.create();
Report.add(group,decision,lab,result);
Report.add(group,decision,lab,{...result,refund_keys:[decision.main]});
const report = Report.report(group);
assert.equal(report.all.core.races,2);
assert.equal(report.all.mixed.races,2);
assert.equal(report.paired.core.races,1);
assert.equal(report.paired.coreMixed.stake,500);
assert.equal(report.paired.coreMixed.payout,7500);
assert.equal(report.paired.main.stake,100);
assert.equal(report.paired.mixed.stake,100);
assert.equal(report.by_month['2026-11'].mixed.payout,7500);
console.log('ROI fifth ticket: saved order, lineup and six-phase gate, dedupe, refund exclusion and matched accounting OK');
