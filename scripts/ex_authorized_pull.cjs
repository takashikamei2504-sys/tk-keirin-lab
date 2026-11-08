'use strict';
/* Pull ONLY an expressly licensed third-party feed.
 * This collector NEVER requests winticket.jp and fails closed on missing rights.
 */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
function config(env=process.env){
 if(env.EX_BULK_RIGHTS_APPROVED!=='true'||env.EX_PUBLICATION_RIGHTS_APPROVED!=='true'||
  !env.EX_RIGHTS_REFERENCE||!env.EX_FEED_URL||!env.EX_FEED_HOST)return null;
 const u=new URL(env.EX_FEED_URL);
 if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port||
    u.hostname!==env.EX_FEED_HOST||/(^|\.)winticket\.jp$/i.test(u.hostname)||
    /(^localhost$|^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname))
     throw Error('UNAPPROVED_EX_SOURCE_HOST');
 return u.href;
}
async function run(env=process.env){
 const url=config(env);
 if(!url){console.log('EX_FEED_DISABLED rights and approved feed not configured');return {skipped:true};}
 const resp=await fetch(url,{
  redirect:'error',signal:AbortSignal.timeout(20000),
  headers:{accept:'application/json', 'user-agent':'TKKeirinLab-ApprovedEXFeed/1.0'}
 });
 if(!resp.ok)throw Error('LICENSED_FEED_HTTP_'+resp.status);
 if(!/application\/json/i.test(resp.headers.get('content-type')||''))throw Error('LICENSED_FEED_NOT_JSON');
 if(Number(resp.headers.get('content-length')||0)>12*1024*1024)throw Error('FEED_TOO_LARGE');
 const text=await resp.text();
 if(Buffer.byteLength(text)>12*1024*1024)throw Error('FEED_TOO_LARGE');
 const json=JSON.parse(text);
 if(json.schema!=='tk-winticket-ex-authorized-feed/v1')throw Error('FEED_SCHEMA_INVALID');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lab-approved-ex-'));
 const file=path.join(dir,'incoming.json');
 try{
  fs.writeFileSync(file,text,{mode:0o600});
  const task=spawnSync(process.execPath,[path.join(__dirname,'ex_approved_ingest.cjs'),
    file,path.join(__dirname,'../data/ex_approved')],{cwd:path.join(__dirname,'..'),
      env,stdio:'inherit',timeout:30000});
  if(task.status!==0)throw Error('EX_FEED_IMPORT_FAILED');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
 return {skipped:false};
}
if(require.main===module)run().catch(e=>{console.error('EX_AUTHORIZED_PULL_ERROR '+e.message);process.exitCode=1;});
module.exports={config,run};
