/**
 * B-AXIS oracle-B exploratory benchmark.
 * Result fields are used ONLY for evaluation, never ticket generation.
 * No claims of calibrated betting probabilities.
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const DEFAULT=path.join(__dirname,'..','research','b-axis','pilot_2026_11_06.json');
function bool(v){return v?1:0;}
function validate(r){
 if(!r||![7,9].includes(r.runners))throw Error('Only 7/9 riders accepted');
 const valid=n=>Number.isInteger(n)&&n>=1&&n<=r.runners;
 if(!valid(r.b_no)||!Array.isArray(r.finish)||r.finish.length!==3||r.finish.some(n=>!valid(n))||new Set(r.finish).size!==3)throw Error('Invalid B or finish: '+r.race_id);
 if(!Array.isArray(r.published_b_line)||!r.published_b_line.includes(r.b_no)||new Set(r.published_b_line).size!==r.published_b_line.length||r.published_b_line.some(n=>!valid(n)))throw Error('Invalid B line: '+r.race_id);
 if(!/^https:\/\//.test(r.source_url||''))throw Error('Missing source: '+r.race_id);
 return r;
}
function flags(r){
 const [one,two]=r.finish, b=r.b_no, line=new Set(r.published_b_line);
 return {b_first:bool(one===b),b_top2:bool(one===b||two===b),b_top3:bool(r.finish.includes(b)),line_wins:bool(line.has(one)),line_member_top2:bool(line.has(one)||line.has(two)),line_pair:bool(line.has(one)&&line.has(two)),line_2_in_trio:bool(r.finish.filter(n=>line.has(n)).length>=2),line_sweep:bool(r.finish.every(n=>line.has(n)))};
}
function summary(rows){
 const validated=rows.map(validate);
 const groups={all:validated,seven:validated.filter(x=>x.runners===7),nine:validated.filter(x=>x.runners===9)};
 return Object.fromEntries(Object.entries(groups).map(([k,v])=>{
  const totals={n:v.length};
  for(const r of v){for(const [name,count] of Object.entries(flags(r)))totals[name]=(totals[name]||0)+count;}
  return [k,totals];
 }));
}
/** Tickets must be generated from frozen pre-start features and selected B,
 * WITHOUT observing finish. Data collection and audit enforce this provenance.
 */
function ticketCapture(rows,rankedByRace){
 const thresholds=[3,5,8,10],out={};
 for(const k of thresholds)out[k]={evaluated:0,hits:0};
 for(const race of rows){
  validate(race);const predicted=rankedByRace[race.race_id];
  if(!predicted)continue;
  if(!Array.isArray(predicted)||predicted.some(t=>!Array.isArray(t)||t.length!==3||new Set(t).size!==3||t.some(n=>!Number.isInteger(n)||n<1||n>race.runners)))throw Error('Invalid prediction: '+race.race_id);
  const keys=predicted.map(t=>t.join('-'));
  if(new Set(keys).size!==keys.length)throw Error('Duplicate ticket: '+race.race_id);
  const target=race.finish.join('-');
  for(const k of thresholds){out[k].evaluated++;if(keys.slice(0,k).includes(target))out[k].hits++;}
 }
 return out;
}
if(require.main===module){
 const file=process.argv[2]||DEFAULT;
 const fixture=JSON.parse(fs.readFileSync(file,'utf8'));
 const report={source:file,summary:summary(fixture.races),ticket_capture:null,reason:'No frozen, result-independent B-conditional tickets provided; top-3/5/8/10 cannot be measured yet.'};
 if(process.argv[3]){const ranked=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));report.ticket_capture=ticketCapture(fixture.races,ranked);report.reason=null;}
 process.stdout.write(JSON.stringify(report,null,2)+'\n');
}
module.exports={validate,flags,summary,ticketCapture};
