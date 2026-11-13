#!/usr/bin/env node
'use strict';
// Separate research-only pre-race B/H/S capture. Never writes production inputs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const norm=s=>String(s||'').replace(/[\s\u3000]/g,'');
const dateJST=ms=>new Date(ms+9*3600000).toISOString().slice(0,10);
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const read=(p,fallback)=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):fallback;
function freeze(parent,raw,feed,{now=Date.now()}={}){
 const race=parent?.out?.input,src=parent?.out?.selection;
 if(parent?.requested!=='auto'||src?.requested!=='auto'||!race||!feed||!raw||!Array.isArray(raw.entries))return null;
 if(parent.race_id!==[race.date,race.venue,race.race_no].join(':')||
  feed.date!==race.date||raw.venue!==race.venue||Number(raw.race_number)!==Number(race.race_no))return null;
 const cutoff=Date.parse(race.date+'T'+race.start+':00+09:00');
 const issued=Date.parse(feed.generated_at),sourceSaved=Date.parse(parent.saved_at),from=Date.parse(race.source?.generated_at);
 if(!Number.isFinite(cutoff)||!Number.isFinite(issued)||!Number.isFinite(sourceSaved)||!Number.isFinite(from)||
  issued>now||issued>=cutoff||now>=cutoff||sourceSaved>=cutoff||from>sourceSaved||race.source?.mode!=='live-public-feed')return null;
 if(raw.entries.length!==race.riders?.length||![7,9].includes(raw.entries.length)||new Set(raw.entries.map(x=>Number(x.car_number))).size!==raw.entries.length)return null;
 const byNo=new Map(race.riders.map(x=>[x.no,x])),lines=new Map();
 race.lineup.forEach((row,i)=>row.forEach((no,j)=>lines.set(no,String(i+1)+'-'+String(j+1))));
 const ordered=raw.entries.slice().sort((a,b)=>Number(a.car_number)-Number(b.car_number)),riders=[];
 for(const e of ordered){
  const rider=byNo.get(Number(e.car_number));
  if(!rider||String(rider.meta?.rider_id||'')!==String(e.rider_id||'')||
   norm(rider.name)!==norm(e.rider_full_name||e.rider_name)||
   String(e.line_position)!==lines.get(Number(e.car_number)))return null;
  const vals=[e.b_count,e.h_count,e.s_count];
  if(vals.some(x=>!Number.isInteger(x)||x<0||x>80))return null;
  riders.push({no:Number(e.car_number),rider_id:String(e.rider_id),line:e.line_position,
   b_count:e.b_count,h_count:e.h_count,s_count:e.s_count});
 }
 return {schema:'tk-crossline-bhs-shadow/v1',race_id:parent.race_id,date:race.date,
  venue:race.venue,race_no:race.race_no,cutoff:new Date(cutoff).toISOString(),
  observed_at:new Date(now).toISOString(),source_generated_at:feed.generated_at,forecast_saved_at:parent.saved_at,
  data_source:'kurinaka12-afk/keirin-app-data',research_only:true,riders};
}
async function run({root=path.resolve(__dirname,'..'),now=Date.now(),feed=null}={}){
 const date=dateJST(now),folder=path.join(root,'data/routed_history',date);
 const dir=path.join(root,'data/crossline_b_history',date),status={date,checked_at:new Date(now).toISOString(),seen:0,frozen:0,existing:0,unavailable:0,invalid:0};
 if(!fs.existsSync(folder))return status;
 if(feed===null){
  const url='https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/'+date+'.json';
  const r=await fetch(url,{signal:AbortSignal.timeout(20000)});
  if(r.status===404)return {...status,feed:'not_published'};
  if(!r.ok)throw Error('BHS research source HTTP '+r.status);
  const body=await r.text();if(body.length>8000000)throw Error('BHS research feed too large');
  feed=JSON.parse(body);
 }
 if(feed.date!==date||!Array.isArray(feed.races)||!Number.isFinite(Date.parse(feed.generated_at))||Date.parse(feed.generated_at)>now)throw Error('Invalid source feed or timestamp');
 const keyed=new Map(feed.races.map(x=>[[date,x.venue,x.race_number].join(':'),x]));
 for(const file of fs.readdirSync(folder).filter(f=>/^[a-f0-9]{64}\.json$/.test(f))){
  status.seen++;
  const parent=read(path.join(folder,file),null),raw=keyed.get(parent?.race_id);
  if(!raw){status.unavailable++;continue;}
  const frozen=freeze(parent,raw,feed,{now});
  if(!frozen){status.invalid++;continue;}
  const target=path.join(dir,hash(parent.race_id+'|tk-crossline-bhs-shadow/v1')+'.json');
  fs.mkdirSync(dir,{recursive:true});
  try{fs.writeFileSync(target,JSON.stringify(frozen)+'\n',{flag:'wx'});status.frozen++;}
  catch(e){if(e.code==='EEXIST')status.existing++;else throw e;}
 }
 const parentDir=path.join(root,'data/crossline_b_history');fs.mkdirSync(parentDir,{recursive:true});
 fs.writeFileSync(path.join(parentDir,'status.json'),JSON.stringify(status)+'\n');
 return status;
}
if(require.main===module)run().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1});
module.exports={freeze,run,hash};
