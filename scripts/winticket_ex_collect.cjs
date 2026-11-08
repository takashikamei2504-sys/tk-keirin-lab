'use strict';
// One-shot, public HTML only. No login, cookies, hidden API calls, retries or bypass.
// For use only where the source's applicable conditions permit collection.
const fs=require('node:fs');
const path=require('node:path');
const {extract}=require('./winticket_ex_extract.cjs');
async function collect(url,outPath) {
  if(!url||!outPath) throw Error('Usage: node scripts/winticket_ex_collect.cjs <public-racecard-url> <local-output-path>');
  const u=new URL(url);
  if(u.protocol!=='https:'||u.hostname!=='www.winticket.jp'||
      !/^\/keirin\/[^/]+\/racecard\/[^/]+\/[0-9]+\/[0-9]+\/?$/.test(u.pathname) ||
      u.search || u.hash) throw Error('PUBLIC_RACECARD_URL_REQUIRED');
  const resp=await fetch(u.toString(),{
    redirect:'error',signal:AbortSignal.timeout(12000),
    headers:{'accept':'text/html','user-agent':'TKKeirinLabEXSourceResearch/0.1 (single public URL, no access-control bypass)'}
  });
  if(!resp.ok) throw Error('HTTP_'+resp.status);
  if(!/^text\/html/i.test(resp.headers.get('content-type')||''))throw Error('NOT_HTML');
  const len=Number(resp.headers.get('content-length'));
  if(len>5*1024*1024) throw Error('SOURCE_TOO_LARGE');
  const html=await resp.text();
  if(html.length>5*1024*1024)throw Error('SOURCE_TOO_LARGE');
  const result=extract(html,{source_url:url,captured_at:new Date().toISOString()});
  if(!result.summary.players_with_ex) throw Error('NO_EX_FIELDS_VISIBLE');
  fs.mkdirSync(path.dirname(outPath),{recursive:true});
  // Never place raw source observations in a public repository by default.
  fs.writeFileSync(outPath,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  return {saved:outPath,summary:result.summary,field_status:result.key_status};
}
if(require.main===module){
  collect(process.argv[2],process.argv[3])
   .then(x=>console.log('WINTICKET_EX_COLLECT '+JSON.stringify(x)))
   .catch(e=>{console.error('WINTICKET_EX_COLLECT_ERROR '+e.message);process.exitCode=1;});
}
module.exports={collect};
