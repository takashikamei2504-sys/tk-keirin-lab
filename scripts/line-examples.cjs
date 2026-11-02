'use strict';
const fs=require('node:fs'),Engine=require('../js/line/engine.js'),Old=require('../js/story-brain.js'),History=require('./history-store.cjs');
const records=History.load('data/lab_history','2026-11-02').predictions;
const targets=[records.find(x=>x.input.venue==='防府'&&x.input.race_no===12&&x.pre_race),records.find(x=>x.input.riders.length===7&&x.pre_race)];
fs.mkdirSync('reports/line',{recursive:true});const comparisons=[];
for(const p of targets){if(!p)throw Error('Missing frozen fixture');const n=p.input.riders.length,pack=p.provenance?.replay_pack||{evidence:(p.evidence||[]).filter(x=>x.numeric!==false),observations:(p.evidence||[]).filter(x=>x.numeric===false),relationships:p.relationship_evidence||[]};
 const out=Engine.build(p.input,{intelligence:pack},{asOf:Date.parse(p.saved_at),replay:true}),old=Old.build(out.input.race,out.input.replay_pack);
 fs.writeFileSync(`reports/line/example-${n}.json`,JSON.stringify(out)+'\n');
 comparisons.push({race_id:p.race_id,source_saved_at:p.saved_at,input_sha256:out.provenance.input_sha256,mode:'historical-replay',old:{version:old.version,explanation:old.story.main.explanation,chosen:old.chosen.map(x=>x.key),axis:'旧LABに統一された5軸選定の出力なし',original_frozen_version:p.version,original_frozen_tickets:p.chosen.map(x=>x.key)},line:{version:out.version,main:out.main.finish,axis:out.decision,chosen:out.tickets.map(x=>x.key),alternatives:out.alternatives.slice(0,3).map(x=>({id:x.id,pair:x.finish.pair,mode:x.finish.mode,not_selected:x.not_selected}))}});
 console.log(JSON.stringify({race:p.race_id,axis:out.decision.label,chosen:out.compressed,old:old.chosen.map(x=>x.key),main:out.main.scenes.map(s=>({phase:s.phase,events:s.events.map(e=>e.action)}))}));
}
fs.writeFileSync('reports/line/comparison.json',JSON.stringify(comparisons,null,2)+'\n');
