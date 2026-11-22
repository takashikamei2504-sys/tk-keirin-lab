'use strict';
/* Choose one configured source BEFORE collection. Never retry a denied request
 * through another host/client. Preserve the last verified pack on any failure. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const Pull=require('./ex_authorized_pull.cjs');
const ROOT=path.join(__dirname,'..');
const read=p=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):null;
function selectSource(env){
 if(env.EX_FEED_URL||env.EX_FEED_HOST){
  if(!env.EX_FEED_URL||!env.EX_FEED_HOST)throw Error('EX_FEED_CONFIGURATION_INCOMPLETE');
  if(env.EX_MODEL_RIGHTS_APPROVED!=='true'||!Pull.config(env))throw Error('EX_FEED_SCOPE_INCOMPLETE');
  return {source:'authorized_feed',script:'ex_authorized_pull.cjs'};
 }
 return {source:'public_html',script:'ex_winticket_live_collect.cjs'};
}
function fingerprint(pack){return crypto.createHash('sha256').update(JSON.stringify({riders:pack?.riders||{},race_contexts:pack?.race_contexts||{}})).digest('hex');}
function errorCode(text){
 const s=String(text||'');const http=s.match(/(?:ACCESS_RESTRICTED_)?WINTICKET_HTTP_\d+|LICENSED_FEED_HTTP_\d+/);
 if(http)return http[0];
 return s.replace(/(?:WT_EX_LIVE_ERROR|EX_AUTHORIZED_PULL_ERROR)\s*/g,'').match(/(?:EX|WT_EX|FEED|SOURCE|UNAPPROVED|LICENSED_FEED)_[A-Z_]+/)?.[0]||'EX_COLLECTION_FAILED';
}
function saveAttempt(root,previous,attempt){
 const dir=path.join(root,'data/ex_approved');fs.mkdirSync(dir,{recursive:true});
 const latest=read(path.join(dir,'latest.json'));let newest=null;
 for(const row of Object.values(latest?.riders||{}))if(Number.isFinite(Date.parse(row.collected_at))&&(!newest||Date.parse(row.collected_at)>Date.parse(newest)))newest=row.collected_at;
 const status={...(previous||{}),schema:'tk-ex-collection-status/v1',
  state:attempt.error?(/HTTP_(401|403|429)$/.test(attempt.error)?'source_access_blocked':'collection_error'):attempt.data_updated?'licensed-feed-published':'no_new_observations',
  last_attempt_at:attempt.checked_at,last_attempt_source:attempt.source,last_attempt_ok:!attempt.error,
  last_attempt_error:attempt.error||null,last_http_status:Number(attempt.error?.match(/HTTP_(\d+)$/)?.[1])||null,
  data_updated:attempt.data_updated,newest_observation_at:newest,
  model_data_available:Boolean(latest?.summary?.valid_metrics||latest?.summary?.valid_context_buckets),
  approved_feed_configured:attempt.approved_feed_configured};
 const temp=path.join(dir,'status.json.tmp');fs.writeFileSync(temp,JSON.stringify(status,null,2)+'\n');fs.renameSync(temp,path.join(dir,'status.json'));return status;
}
function run({root=ROOT,env=process.env,spawn=spawnSync,at=()=>new Date().toISOString()}={}){
 const dir=path.join(root,'data/ex_approved'),latestPath=path.join(dir,'latest.json'),beforeBytes=fs.existsSync(latestPath)?fs.readFileSync(latestPath):null,before=read(latestPath),previous=read(path.join(dir,'status.json'));
 const attempt={checked_at:at(),source:'configuration',error:null,data_updated:false,approved_feed_configured:Boolean(env.EX_FEED_URL&&env.EX_FEED_HOST)};
 try{
  const selected=selectSource(env);attempt.source=selected.source;
  const child=spawn(process.execPath,[path.join(root,'scripts',selected.script)],{cwd:root,env,encoding:'utf8',timeout:600000,maxBuffer:1024*1024});
  // Publish count summaries only; provider URLs/tokens and raw response bodies stay out of logs.
  for(const line of String(child.stdout||'').split('\n'))if(/^(EX_APPROVED_INGEST|WT_EX_DISCOVERY|EX_FEED_DISABLED|WT_EX_LIVE_DISABLED) /.test(line))console.log(line);
  if(child.error)throw Error(child.error.code==='ETIMEDOUT'?'EX_COLLECTION_TIMEOUT':'EX_COLLECTION_PROCESS_ERROR');
  if(child.status!==0)throw Error(errorCode(child.stderr));
  attempt.data_updated=fingerprint(before)!==fingerprint(read(latestPath));
  // An old/replayed feed must not make generated_at look fresh to existing readers.
  if(!attempt.data_updated&&beforeBytes)fs.writeFileSync(latestPath,beforeBytes);
 }catch(e){attempt.error=errorCode(e.message);}
 // The importer alone updates the verified pack/history and last-success metadata.
 const imported=attempt.error||!attempt.data_updated?previous:read(path.join(dir,'status.json'))||previous;
 const status=saveAttempt(root,imported,attempt);
 console.log('EX_COLLECTION_ATTEMPT '+JSON.stringify({source:attempt.source,state:status.state,data_updated:attempt.data_updated,error:attempt.error,newest_observation_at:status.newest_observation_at}));
 return {ok:!attempt.error,status};
}
if(require.main===module){try{if(!run().ok)process.exitCode=1;}catch(e){console.error('EX_SOURCE_ERROR '+errorCode(e.message));process.exitCode=1;}}
module.exports={selectSource,fingerprint,errorCode,saveAttempt,run};
