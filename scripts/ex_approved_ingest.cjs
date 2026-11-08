'use strict';
/* Local-only authorized EX feed importer. No winticket.jp access.
 * Emits public data ONLY if the operator has a redistribution agreement.
 */
const fs=require('node:fs');
const path=require('node:path');
const Bridge=require('./winticket_ex_bridge.cjs');
const APPROVAL='approved-for-model-and-publication';
const inputSchema='tk-winticket-ex-authorized-feed/v1';
const MAX_SNAPSHOTS=2500;
const MAX_HISTORY=10000;
const cleanID=v=>String(v||'').replace(/^0+(?=\d)/,'');
function assertApproved(feed,permit){
 const p=permit||{};
 if(p.approved!==true||p.redistributionApproved!==true||
   typeof p.reference!=='string'||p.reference.trim().length<5)
   throw Error('EX_RIGHTS_NOT_APPROVED');
 if(feed?.schema!==inputSchema||!Array.isArray(feed.snapshots)||
   feed.snapshots.length>MAX_SNAPSHOTS||feed.license?.source!=='WINTICKET'||
   feed.license?.reference!==p.reference||
   feed.license?.bulk_collection_approved!==true||
   feed.license?.public_redistribution_approved!==true||
   feed.license?.model_use_approved!==true)throw Error('EX_FEED_OR_RIGHTS_SCOPE_INVALID');
 if(feed.license.expires_at && (!Number.isFinite(Date.parse(feed.license.expires_at))||
   Date.now()>Date.parse(feed.license.expires_at)))throw Error('EX_RIGHTS_EXPIRED');
}
function validateRace(row){
 if(!row||typeof row!=='object'||typeof row.venue!=='string'||row.venue.length<1||row.venue.length>24||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.date||'')||!Number.isInteger(row.race_no)||row.race_no<1||row.race_no>12||
    typeof row.race_start!=='string'||!Number.isFinite(Date.parse(row.race_start))||
    new Date(Date.parse(row.race_start)+9*3600000).toISOString().slice(0,10)!==row.date)
    throw Error('RACE_METADATA_INVALID');
}
function ingest(feed,previous={},permit){
 assertApproved(feed,permit);
 const riders={};
 const old=previous?.schema==='tk-b-axis-ex-observations/v1'&&previous?.license_status===APPROVAL&&
   previous?.redistribution_approved===true?previous.riders||{}:{};
 for(const [id,v] of Object.entries(old)){
   if(/^\d{3,10}$/.test(id)&&v&&Number.isFinite(Date.parse(v.collected_at)))riders[id]=v;
 }
 const history=[],venues=new Set(),races=new Set(),skipped={invalid:0,late:0,empty:0};
 for(const row of feed.snapshots){
  try{
   validateRace(row);
   const bridged=Bridge.bridge(row.snapshot,row.race_start);
   if(bridged.source_race_id===null)throw Error('MISSING_SOURCE_RACE_ID');
   const key=[row.date,row.venue,row.race_no].join(':');
   if(races.has(key))throw Error('DUPLICATE_RACE');
   races.add(key);venues.add(row.venue);
   let n=0;
   for(const [id,record] of Object.entries(bridged.riders)){
     if(!/^\d{3,10}$/.test(cleanID(id)))continue;
     if(!record.source_url.startsWith('https://www.winticket.jp/keirin/'))continue;
     // Never overwrite a later first-seen observation with an earlier one.
     const before=riders[id];
     if(!before||Date.parse(record.collected_at)>=Date.parse(before.collected_at)){
       riders[id]=record;n++;
     }
   }
   if(!n)skipped.empty++;
   history.push({key,source_race_id:bridged.source_race_id,
      collected_at:row.snapshot.captured_at,source_url:row.snapshot.source_url,
      venue:row.venue,race_start:row.race_start,
      riders:bridged.riders});
  }catch(e){
    if(e.message==='PRE_RACE_SNAPSHOT_REQUIRED')skipped.late++;
    else skipped.invalid++;
  }
 }
 const sorted=Object.fromEntries(Object.entries(riders)
   .sort(([a],[b])=>a.localeCompare(b,'en',{numeric:true})).slice(-MAX_HISTORY));
 const count=Object.values(sorted).reduce((s,r)=>s+Object.keys(r.metrics||{}).length,0);
 const result={
  schema:'tk-b-axis-ex-observations/v1',
  license_status:APPROVAL,redistribution_approved:true,
  generated_at:new Date().toISOString(),
  source_type:'rights-approved-original-winticket-ex-records',
  license_expires_at:feed.license.expires_at||null,
  summary:{covered_venues:venues.size,covered_races:races.size,unique_riders:Object.keys(sorted).length,
    valid_metrics:count,skipped,observed_venues:[...venues].sort()},
  riders:sorted
 };
 return {latest:result,history};
}
function main(argv,env=process.env){
 if(argv.length!==2)throw Error('Usage: node scripts/ex_approved_ingest.cjs AUTHORIZED_FEED.json OUTPUT_DIRECTORY');
 const [file,dir]=argv;
 const permit={approved:env.EX_BULK_RIGHTS_APPROVED==='true',
  redistributionApproved:env.EX_PUBLICATION_RIGHTS_APPROVED==='true',
  reference:env.EX_RIGHTS_REFERENCE};
 const feed=JSON.parse(fs.readFileSync(file,'utf8'));
 const latestPath=path.join(dir,'latest.json');
 const previous=fs.existsSync(latestPath)?JSON.parse(fs.readFileSync(latestPath,'utf8')):{};
 const {latest,history}=ingest(feed,previous,permit);
 if(!history.length)throw Error('NO_VALID_PRE_RACE_RACES');
 const stamp=new Date().toISOString().slice(0,10);
 const historyDir=path.join(dir,'history');
 fs.mkdirSync(historyDir,{recursive:true});
 const historyFile=path.join(historyDir,stamp+'.jsonl');
 const existing=fs.existsSync(historyFile)?fs.readFileSync(historyFile,'utf8').split('\n').filter(Boolean):[];
 const seen=new Set(existing.map(line=>{try{const x=JSON.parse(line);return x.key+'|'+x.collected_at;}catch(e){return null;}}));
 const append=history.filter(x=>!seen.has(x.key+'|'+x.collected_at))
   .map(x=>JSON.stringify(x));
 if(append.length)fs.appendFileSync(historyFile,append.join('\n')+'\n',{mode:0o600});
 fs.writeFileSync(latestPath,JSON.stringify(latest,null,2)+'\n',{mode:0o600});
 fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify({
  schema:'tk-ex-collection-status/v1',
  state:'licensed-feed-published',source:'authorized-ex-feed',
  last_success_at:latest.generated_at,venues_collected:latest.summary.covered_venues,
  races_collected:latest.summary.covered_races,valid_metrics:latest.summary.valid_metrics,
  model_data_available:latest.summary.valid_metrics>0,
  public_distribution_approved:true
 },null,2)+'\n',{mode:0o600});
 console.log('EX_APPROVED_INGEST '+JSON.stringify({races:history.length,venues:latest.summary.covered_venues,
  riders:latest.summary.unique_riders,metrics:latest.summary.valid_metrics,
  appended:append.length,skipped:latest.summary.skipped}));
}
if(require.main===module){try{main(process.argv.slice(2));}catch(e){console.error('EX_INGEST_ERROR '+e.message);process.exitCode=1;}}
module.exports={ingest,assertApproved,validateRace};
