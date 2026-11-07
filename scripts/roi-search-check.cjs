'use strict';

// Bounded offline diagnostic. Replay only time-stamped inputs already frozen by LINE.
const path = require('node:path');
const Engine = require('../js/line/engine.js');
const {readHistory} = require('./roi-audit.cjs');
const {latest} = require('../js/roi/audit.cjs');

function inspect(record, widths = [32,96,160]) {
  const input = record.out.input;
  return widths.map(width=>{
    const out = Engine.build(input.race,{intelligence:input.replay_pack},{width,asOf:input.as_of,replay:true});
    const heads = [...new Set(out.candidate_evaluations.map(c=>c.pair[0]))];
    const lines = out.topology.lines.map(line=>({
      size:line.length, represented_heads:line.members.filter(n=>heads.includes(n)).length,
      candidates:out.candidate_evaluations.filter(c=>line.members.includes(c.pair[0])).length
    }));
    return {width,generated:out.search.generated,pruned:out.search.pruned,
      candidates:out.search.audit_passed,heads:heads.length,lines};
  });
}

if (require.main === module) {
  const date = process.argv[2] || '2026-11-06';
  const {line} = readHistory(path.join(__dirname,'../data'),{withResults:false,from:date});
  const eligible = latest(line).filter(p=>p.input.date===date);
  const picks = [eligible.find(p=>p.input.riders.length===7),eligible.find(p=>p.input.riders.length===9)].filter(Boolean);
  console.log(JSON.stringify(picks.map(p=>({cars:p.input.riders.length,scenarios:inspect(p)}))));
}
module.exports = {inspect};
