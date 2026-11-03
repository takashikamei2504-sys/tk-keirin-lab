'use strict';
/* Compact audit only; no new rider dataset or article excerpts are published. */
const fs=require('node:fs'),Engine=require('../js/line/engine.js'),P=require('../js/model-provenance.js');
const rows=[];
for(const n of [7,9]){
 const previous=JSON.parse(fs.readFileSync(`reports/line/example-${n}.json`,'utf8')),race=previous.input.race,packs={intelligence:previous.input.replay_pack};
 const out=Engine.build(race,packs,{asOf:Date.parse(previous.input.as_of),replay:true});
 rows.push({riders:n,race_id:`${race.date}:${race.venue}:${race.race_no}`,input_as_of:previous.input.as_of,underlying_input_sha256:P.sha256({race,pack:previous.input.replay_pack}),previous_line:{version:previous.version,axis:previous.decision.label,tickets:previous.tickets.map(t=>t.key)},updated_line:{version:out.version,model_id:out.provenance.model.model_id,axis:out.decision.label,main_pair:out.main.finish.pair,tickets:out.tickets.map(t=>t.key),main_reason:out.decision.selection_reason,axis_rounds:out.decision.rounds,sensitivity:{changed:out.decision.sensitivity.changed,scenarios:out.decision.sensitivity.scenarios,nearest_boundaries:out.decision.sensitivity.thresholds.slice(0,3)},search:out.search},mode:'historical-replay'});
}
fs.mkdirSync('reports/line',{recursive:true});fs.writeFileSync('reports/line/v1.2-checks.json',JSON.stringify({schema:'tk-line-comparison/v1',scope:'同じ保存済み発走前入力による再計算。後付け予想を発走前予想として保存しない。',rows},null,2)+'\n');
console.log(JSON.stringify(rows.map(x=>({race_id:x.race_id,old:x.previous_line.tickets,new:x.updated_line.tickets,axis:x.updated_line.axis}))));
