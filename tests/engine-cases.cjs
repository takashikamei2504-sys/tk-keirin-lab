'use strict';
const sample=require('../race_sample.json'),seven=structuredClone(sample);seven.riders=seven.riders.slice(0,7);seven.lineup=seven.lineup.map(l=>l.filter(n=>n<=7)).filter(l=>l.length);
const target=require('../data/lab_history/2026-11-02.json').predictions.find(p=>p.input?.venue==='防府'&&p.input.race_no===12&&p.pre_race).input;
const lone=structuredClone(seven);lone.lineup=[[1,2,3],[4,5],[6,7]];lone.riders.forEach(x=>x.style=x.no===1?'逃':'追');
const fragmented=structuredClone(sample);fragmented.lineup=[[1,2],[3,4],[5,6],[7],[8],[9]];
module.exports=[{id:'hofu-20261102-12',race:target,pack:{}},{id:'nine',race:sample,pack:{}},{id:'seven',race:seven,pack:{}},{id:'one-initiator',race:lone,pack:{}},{id:'fragmented-nine',race:fragmented,pack:{}}];
