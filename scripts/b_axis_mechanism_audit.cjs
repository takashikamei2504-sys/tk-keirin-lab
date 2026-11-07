'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const filename=path.join(__dirname,'..','research/b-axis/official_mechanisms_2026_07.json');
const data=JSON.parse(fs.readFileSync(filename,'utf8'));
assert.equal(data.schema,'tk-baxis-official-event-annotation/v1');
assert.equal(data.denominator,'NOT_OBSERVED');
assert.equal(data.blocks_rate,null);
const events=data.events;
assert(Array.isArray(events)&&events.length>=6);
const counts={total:events.length,explicitBlocks:0,affectedOrDisrupted:0,temporaryBlock:0,confirmedDetachment:0,gapOpened:0,followed:0,insideWin:0,unmeasured:true};
for(const e of events){
 assert.match(e.race_id,/^2026-07-1[78]:高知:\d+$/);
 assert(e.note?.length>=10&&e.note.length<150);
 assert.match(e.source_url,/^https:\/\/keirin\.jp\/pc\/dfw\/portal\/guest\/report\/graderace\/summer\/2026\/report_[12]\.html$/);
 assert(['block_attempt','follow_gap','inside_pass'].includes(e.type));
 if(e.type==='block_attempt'){
  assert(e.defender&&e.attacker);
  assert(['disrupted','temporary_only','unknown','passed'].includes(e.outcome));
  counts.explicitBlocks++;
  if(e.outcome==='disrupted')counts.affectedOrDisrupted++;
  if(e.outcome==='temporary_only')counts.temporaryBlock++;
 }
 if(e.type==='follow_gap'){
  assert(e.rider);
  if(e.outcome==='detached')counts.confirmedDetachment++;
  else if(e.outcome==='gap_opened')counts.gapOpened++;
  else if(e.outcome==='followed')counts.followed++;
  else throw Error('unexpected follow outcome');
 }
 if(e.type==='inside_pass'){
  assert(e.rider&&e.outcome==='inside_won');
  counts.insideWin++;
 }
}
const report={
 schema:'tk-baxis-selected-report-mechanisms/v1',source:'JKA official GII race-report examples, 2026-07-17 and 2026-07-18',
 selectedCounts:counts,
 blockSuccessRate:null,blockFailureRate:null,followDetachRate:null,
 limitation:'Not systematically sampled. A denominator of every attempted block or follower contact is unavailable. This is qualitative route evidence, not population probabilities.',
 checked:event=>null
};
delete report.checked;
process.stdout.write('B_AXIS_MECHANISMS '+JSON.stringify(report)+'\n');
module.exports={counts,events};
