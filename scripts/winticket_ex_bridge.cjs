'use strict';
// Convert privately held WINTICKET EX source snapshots into the existing
// tk-b-axis-ex-observations/v1 input format. Never infer absent counts.
const fs=require('node:fs');
const path=require('node:path');
const {FIELD_MAP,knownCounts}=require('./winticket_ex_extract.cjs');
const CONFIRMED=new Set(['exSpurt','exThrust','exSplitLine','exLeftBehind','exSnatch']);

function bridge(snapshot, raceStart) {
  if(snapshot?.schema!=='tk-winticket-ex-raw-snapshot/v1' || !snapshot?.source_url ||
     !Array.isArray(snapshot?.riders)) throw Error('SOURCE_SNAPSHOT_INVALID');
  const cutoff=Date.parse(raceStart), collected=Date.parse(snapshot.captured_at);
  if(!Number.isFinite(cutoff)||!Number.isFinite(collected)||collected>=cutoff)
    throw Error('PRE_RACE_SNAPSHOT_REQUIRED');
  const riders={};
  for(const rider of snapshot.riders) {
    const id=String(rider.player_id||'').replace(/^0+(?=\d)/,'');
    if(!/^\d{3,10}$/.test(id) || riders[id]) continue;
    const metrics={};
    for(const key of CONFIRMED) {
      const m=FIELD_MAP[key];
      const v=rider.source_fields?.[key];
      if(v===undefined || v===null) continue;
      const c=knownCounts(v);
      if(c) metrics[m]=c;
    }
    if(Object.keys(metrics).length)
      riders[id]={
        source_url:snapshot.source_url,
        // First visible by this observation time; no independent publication-time claim.
        published_at:snapshot.captured_at,
        collected_at:snapshot.captured_at,
        metrics
      };
  }
  return {
    schema:'tk-b-axis-ex-observations/v1',
    generated_at:new Date().toISOString(),
    source_type:'winticket_pre_race_racecard_snapshot',
    source_race_id:snapshot.race_id,
    race_start:raceStart,
    riders
  };
}

function main(argv) {
  if(argv.length!==3)throw Error('Usage: node scripts/winticket_ex_bridge.cjs SNAPSHOT.json RACE_START_ISO OUTPUT_PRIVATE.json');
  const [input,raceStart,out]=argv;
  const data=bridge(JSON.parse(fs.readFileSync(input,'utf8')),raceStart);
  if(!Object.keys(data.riders).length)throw Error('NO_COUNTED_EX_METRICS');
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
  process.stdout.write('WINTICKET_EX_BRIDGE '+JSON.stringify({
    counted_riders:Object.keys(data.riders).length,
    metric_count:Object.values(data.riders).reduce((s,r)=>s+Object.keys(r.metrics).length,0),
    saved:out})+'\n');
}
if(require.main===module){
  try{main(process.argv.slice(2));}
  catch(e){console.error('WINTICKET_EX_BRIDGE_ERROR '+e.message);process.exitCode=1;}
}
module.exports={bridge};
