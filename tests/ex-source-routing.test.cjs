'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const C=require('../scripts/ex_collect_source.cjs');
const env={EX_BULK_RIGHTS_APPROVED:'true',EX_PUBLICATION_RIGHTS_APPROVED:'true',EX_MODEL_RIGHTS_APPROVED:'true',EX_RIGHTS_REFERENCE:'source-agreement-reference',EX_FEED_URL:'https://licensed.example.test/feed?token=do-not-log',EX_FEED_HOST:'licensed.example.test'};
assert.equal(C.selectSource({}).source,'public_html');assert.equal(C.selectSource(env).script,'ex_authorized_pull.cjs');
for(const bad of [{EX_FEED_URL:env.EX_FEED_URL},{...env,EX_FEED_HOST:'other.example.test'},{...env,EX_FEED_URL:'http://licensed.example.test/feed'},{...env,EX_FEED_URL:'https://www.winticket.jp/keirin/racecard/',EX_FEED_HOST:'www.winticket.jp'},{...env,EX_MODEL_RIGHTS_APPROVED:'false'}])assert.throws(()=>C.selectSource(bad));
assert.equal(C.errorCode('WT_EX_LIVE_ERROR WINTICKET_HTTP_403'),'WINTICKET_HTTP_403');assert.equal(C.errorCode('EX_AUTHORIZED_PULL_ERROR LICENSED_FEED_HTTP_503'),'LICENSED_FEED_HTTP_503');
function setup(run){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ex-source-test-')),dir=path.join(root,'data/ex_approved');fs.mkdirSync(path.join(dir,'history'),{recursive:true});
 const latest={schema:'tk-b-axis-ex-observations/v1',summary:{valid_metrics:2,valid_context_buckets:1},riders:{'12345':{collected_at:'2026-11-14T06:00:00Z',metrics:{kamashi:{events:1,opportunities:2}}}}};
 fs.writeFileSync(path.join(dir,'latest.json'),JSON.stringify(latest));fs.writeFileSync(path.join(dir,'history/2026-11-14.jsonl'),'immutable\n');fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify({schema:'tk-ex-collection-status/v1',state:'licensed-feed-published',last_success_at:'2026-11-14T06:01:00Z',valid_metrics:2}));
 try{run({root,dir,latest});}finally{fs.rmSync(root,{recursive:true,force:true});}
}
for(const http of [401,403,429])setup(({root,dir})=>{
 const bytes=fs.readFileSync(path.join(dir,'latest.json'));let calls=0;
 const r=C.run({root,env:{},at:()=> '2026-11-22T07:25:01Z',spawn:()=>{calls++;return {status:1,stderr:'WT_EX_LIVE_ERROR WINTICKET_HTTP_'+http};}});
 assert.equal(calls,1);assert.equal(r.ok,false);assert.equal(r.status.state,'source_access_blocked');assert.equal(r.status.last_http_status,http);assert.equal(r.status.last_success_at,'2026-11-14T06:01:00Z');assert.equal(r.status.newest_observation_at,'2026-11-14T06:00:00Z');assert.equal(r.status.data_updated,false);assert.equal(r.status.model_data_available,true);assert.deepEqual(fs.readFileSync(path.join(dir,'latest.json')),bytes);assert.equal(fs.readFileSync(path.join(dir,'history/2026-11-14.jsonl'),'utf8'),'immutable\n');
});
setup(({root})=>{
 const commands=[];const r=C.run({root,env,spawn:(exe,args)=>{commands.push(args[0]);return {status:1,stderr:'EX_AUTHORIZED_PULL_ERROR LICENSED_FEED_HTTP_403 '+env.EX_FEED_URL};}});
 assert.equal(commands.length,1);assert(commands[0].endsWith('ex_authorized_pull.cjs'));assert.equal(r.status.last_attempt_source,'authorized_feed');assert.equal(r.status.last_http_status,403);assert(!JSON.stringify(r.status).includes('do-not-log'));
});
setup(({root})=>{
 let calls=0;const r=C.run({root,env:{EX_FEED_URL:env.EX_FEED_URL},spawn:()=>{calls++;}});assert.equal(calls,0);assert.equal(r.ok,false);assert.equal(r.status.last_attempt_error,'EX_FEED_CONFIGURATION_INCOMPLETE');
});
setup(({root,dir,latest})=>{
 const r=C.run({root,env,spawn:()=>{latest.riders['12345'].collected_at='2026-11-22T06:00:00Z';fs.writeFileSync(path.join(dir,'latest.json'),JSON.stringify(latest));fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify({last_success_at:'2026-11-22T06:01:00Z'}));return {status:0,stdout:'EX_APPROVED_INGEST {"races":1}'};}});
 assert.equal(r.ok,true);assert.equal(r.status.data_updated,true);assert.equal(r.status.last_success_at,'2026-11-22T06:01:00Z');assert.equal(r.status.newest_observation_at,'2026-11-22T06:00:00Z');
});
setup(({root,dir})=>{
 const r=C.run({root,env:{},spawn:()=>{fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify({last_success_at:'2026-11-22T06:01:00Z'}));return {status:0};}});
 assert.equal(r.ok,true);assert.equal(r.status.state,'no_new_observations');assert.equal(r.status.last_success_at,'2026-11-14T06:01:00Z');
});
const yaml=fs.readFileSync(path.join(__dirname,'../.github/workflows/ex-approved-ingest.yml'),'utf8');assert(yaml.includes('always() && !cancelled()'));assert(yaml.includes('secrets.EX_FEED_URL'));assert(yaml.includes('vars.EX_FEED_HOST'));assert(yaml.includes('node scripts/ex_collect_source.cjs'));assert(yaml.includes("github.ref == 'refs/heads/main'"));
console.log('EX_SOURCE_ROUTING_TESTS_OK default HTML, explicit feed, no fallback after denial, preserved observations/history, truthful failure/no-new-data status, secret-safe diagnostics');
