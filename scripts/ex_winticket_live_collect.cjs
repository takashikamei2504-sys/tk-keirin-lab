'use strict';
/* Authorized live WINTICKET racecard collector.
 * Discovers only the current official racecard index, applies a request budget,
 * preserves time of first observation, excludes races already started, and
 * delegates persistence to the provenance-aware EX importer.
 */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {extract,extractPreloadedState,getRaceData}=require('./winticket_ex_extract.cjs');
const {validateRace}=require('./ex_approved_ingest.cjs');
const DOMAIN='https://www.winticket.jp';
const VENUES=Object.freeze({
  hakodate:'函館',aomori:'青森',iwakidaira:'いわき平',yahiko:'弥彦',maebashi:'前橋',
  toride:'取手',utsunomiya:'宇都宮',omiya:'大宮',seibuen:'西武園',
  keiokaku:'京王閣',tachikawa:'立川',matsudo:'松戸',chiba:'千葉',
  kawasaki:'川崎',hiratsuka:'平塚',odawara:'小田原',ito:'伊東',shizuoka:'静岡',
  nagoya:'名古屋',gifu:'岐阜',ogaki:'大垣',toyohashi:'豊橋',toyama:'富山',
  matsusaka:'松阪',yokkaichi:'四日市',fukui:'福井',nara:'奈良',
  mukomachi:'向日町',wakayama:'和歌山',kishiwada:'岸和田',
  tamano:'玉野',hiroshima:'広島',hofu:'防府',takamatsu:'高松',
  komatsushima:'小松島',kochi:'高知',matsuyama:'松山',kokura:'小倉',
  kurume:'久留米',takeo:'武雄',sasebo:'佐世保',beppu:'別府',kumamoto:'熊本'
});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function localDate(unixMs){
 return new Date(unixMs+9*3600000).toISOString().slice(0,10);
}
function discover(html){
 const found=new Map();
 const rx=/(?:https:\/\/www\.winticket\.jp)?\/keirin\/([a-z]+)\/racecard\/(\d{10})\/(\d+)\/(\d+)/g;
 for(const m of html.matchAll(rx)){
   const slug=m[1],cup=m[2],day=Number(m[3]),no=Number(m[4]);
   if(!Object.hasOwn(VENUES,slug)||cup.slice(8)!==({hakodate:'11',aomori:'12',iwakidaira:'13',yahiko:'21',
    maebashi:'22',toride:'23',utsunomiya:'24',omiya:'25',seibuen:'26',keiokaku:'27',
    tachikawa:'28',matsudo:'31',chiba:'32',kawasaki:'34',hiratsuka:'35',odawara:'36',
    ito:'37',shizuoka:'38',nagoya:'42',gifu:'43',ogaki:'44',toyohashi:'45',toyama:'46',
    matsusaka:'47',yokkaichi:'48',fukui:'51',nara:'53',mukomachi:'54',wakayama:'55',
    kishiwada:'56',tamano:'61',hiroshima:'62',hofu:'63',takamatsu:'71',
    komatsushima:'73',kochi:'74',matsuyama:'75',kokura:'81',kurume:'83',
    takeo:'84',sasebo:'85',beppu:'86',kumamoto:'87'})[slug])continue;
   if(day<1||day>7||no<1||no>12)continue;
   const pathname='/keirin/'+slug+'/racecard/'+cup+'/'+day+'/'+no;
   found.set(pathname,{pathname,slug,venue:VENUES[slug],day,no,cup});
 }
 return [...found.values()].sort((a,b)=>a.venue.localeCompare(b.venue,'ja')||a.no-b.no);
}
function coverVenuesFirst(entries,limit){
 const byVenue=new Map();
 for(const e of entries){if(!byVenue.has(e.venue))byVenue.set(e.venue,[]);byVenue.get(e.venue).push(e);}
 const groups=[...byVenue].sort(([a],[b])=>a.localeCompare(b,'ja')).map(([,v])=>v.sort((a,b)=>a.no-b.no));
 const result=[];
 while(result.length<limit){
   let used=0;
   for(const group of groups){if(result.length>=limit)break;
     if(group.length){result.push(group.shift());used++;}
   }
   if(!used)break;
 }
 return result;
}

async function getHTML(pathname,timeoutMs=15000){
 if(!(/^\/keirin\/racecard\/?$/.test(pathname)||
     /^\/keirin\/[a-z]+\/racecard\/\d{10}\/[1-7]\/(?:[1-9]|1[0-2])$/.test(pathname)))throw Error('SOURCE_PATH_INVALID');
 const response=await fetch(DOMAIN+pathname,{redirect:'error',signal:AbortSignal.timeout(timeoutMs),
  headers:{accept:'text/html','user-agent':'TKKeirinLabEX/1.0 (permission-granted, bounded scheduled reader)'}});
 if(!response.ok)throw Error('WINTICKET_HTTP_'+response.status);
 if(!/^text\/html/i.test(response.headers.get('content-type')||''))throw Error('SOURCE_NOT_HTML');
 if(Number(response.headers.get('content-length')||0)>7e6)throw Error('SOURCE_TOO_LARGE');
 const html=await response.text();
 if(Buffer.byteLength(html)>7e6)throw Error('SOURCE_TOO_LARGE');
 return html;
}
function recordFromHTML(html,meta,at,targetDate){
 const state=extractPreloadedState(html);
 const data=getRaceData(state);
 const rawTime=data.race?.startAt;
 if(!Number.isFinite(rawTime))throw Error('RACE_START_MISSING');
 const startMs=rawTime<1e12?rawTime*1000:rawTime;
 if(!Number.isFinite(startMs)||startMs<1e12||startMs>4e12)throw Error('RACE_START_INVALID');
 const raceStart=new Date(startMs).toISOString(),date=localDate(startMs);
 if(date!==targetDate)return {skip:'not_selected_date'};
 if(startMs<=Date.parse(at))return {skip:'after_race_start'};
 if(Number(data.race?.number)!==meta.no)throw Error('RACE_NUMBER_MISMATCH');
 const snapshot=extract(html,{source_url:DOMAIN+meta.pathname,captured_at:at});
 if(!snapshot.race_id||snapshot.summary.players_with_ex<1)throw Error('EX_OBSERVATIONS_MISSING');
 const row={venue:meta.venue,date,race_no:meta.no,race_start:raceStart,snapshot};
 // Only source metadata available before scheduled race start can inform context.
 row.source_context={weather:typeof data.race?.weather==='string'?data.race.weather:null,
   track_length:Number.isFinite(data.race?.distance)?null:null, // distance is race length, NOT bank length
   collected_at:at,source_url:snapshot.source_url};
 validateRace(row);
 return {row};
}
function approved(env=process.env){
 return env.EX_BULK_RIGHTS_APPROVED==='true'&&env.EX_PUBLICATION_RIGHTS_APPROVED==='true'&&
  env.EX_MODEL_RIGHTS_APPROVED==='true'&&
  typeof env.EX_RIGHTS_REFERENCE==='string'&&env.EX_RIGHTS_REFERENCE.trim().length>=5;
}
async function collect(opts={}){
 const env=opts.env||process.env;
 if(!approved(env)){console.log('WT_EX_LIVE_DISABLED incomplete rights scope');return {skipped:true,reason:'rights'};}
 const targetDate=opts.targetDate||localDate(Date.now());
 if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))throw Error('TARGET_DATE_INVALID');
 const minIntervalMs=Math.max(1000,Math.min(10000,Number(env.EX_MIN_INTERVAL_MS)||1500));
 const maxPages=Math.max(1,Math.min(180,Number(env.EX_MAX_RACE_PAGES)||130));
 const maxRuntimeMs=Math.max(30000,Math.min(500000,Number(env.EX_MAX_RUNTIME_MS)||420000));
 const start=Date.now();
 const index=await (opts.getHTML||getHTML)('/keirin/racecard/');
 const entries=discover(index),selected=coverVenuesFirst(entries,maxPages);
 const snapshots=[],stats={indexed:entries.length,selected:selected.length,
   eligible:0,observations:0,after_start:0,invalid:0,errors:0,
   active_venues:[...new Set(entries.map(x=>x.venue))].sort()};
 for(const item of selected){
   if(Date.now()-start>maxRuntimeMs)break;
   await (opts.sleep||sleep)(minIntervalMs);
   try{
     const html=await (opts.getHTML||getHTML)(item.pathname);
     const capturedAt=new Date().toISOString();
     const result=recordFromHTML(html,item,capturedAt,targetDate);
     if(result.skip==='after_race_start'){stats.after_start++;continue;}
     if(result.skip){stats.invalid++;continue;}
     snapshots.push(result.row);
     stats.eligible++;stats.observations+=result.row.snapshot.riders.length;
   }catch(e){
     if(/^WINTICKET_HTTP_(401|403|429)/.test(e.message))throw Error('ACCESS_RESTRICTED_'+e.message);
     stats.errors++;
     if(stats.errors<=5)console.error('WT_EX_RACE_ERROR '+item.pathname+' '+e.message);
   }
 }
 // Log counts only, not source individual EX values.
 console.log('WT_EX_DISCOVERY '+JSON.stringify(stats));
 if(!snapshots.length) return {skipped:true,reason:'no_pre_race_rows',stats};
 return {schema:'tk-winticket-ex-authorized-feed/v1',
  license:{source:'WINTICKET',reference:env.EX_RIGHTS_REFERENCE,
   bulk_collection_approved:true,public_redistribution_approved:true,model_use_approved:true},
  snapshots,stats};
}
async function main(){
 const feed=await collect();
 if(!feed.snapshots?.length)return;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tk-ex-'));
 try{
   const input=path.join(dir,'feed.json');
   fs.writeFileSync(input,JSON.stringify(feed),{mode:0o600});
   const job=spawnSync(process.execPath,[path.join(__dirname,'ex_approved_ingest.cjs'),input,
      path.join(__dirname,'..','data','ex_approved')],{timeout:120000,stdio:'inherit',
      env:process.env,cwd:path.join(__dirname,'..')});
   if(job.status!==0)throw Error('WT_EX_PERSISTENCE_FAILED');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
if(require.main===module)main().catch(e=>{console.error('WT_EX_LIVE_ERROR '+e.message);process.exitCode=1;});
module.exports={VENUES,discover,coverVenuesFirst,recordFromHTML,collect,approved,localDate};
