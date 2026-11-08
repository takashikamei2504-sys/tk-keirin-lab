'use strict';
/* EX A/B prospective freeze. NO results, outcome feeds, payouts or odds are ever read here.
 * One identical historical pre-race input; two independent original-model runs.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Brain=require('../js/race-brain.js');
const Ex=require('../js/ex-profile.js');
const Shadow=require('../js/ex-roi/shadow.cjs');
const History=require('./history-store.cjs');
const Audit=require('../js/roi/audit.cjs');
const {validForecast}=require('../js/roi/audit.cjs');
const ROOT=path.join(__dirname,'..');
const jst=ts=>new Date(ts+9*3600000).toISOString().slice(0,10);
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function model(){
 const files=['js/ex-profile.js','js/tactical-transitions.js','js/race-brain.js','js/ex-roi/shadow.cjs','scripts/ex-ab-freeze.cjs'];
 const h=crypto.createHash('sha256');
 for(const file of files)h.update(file).update(fs.readFileSync(path.join(ROOT,file)));
 return Shadow.VERSION+'@'+h.digest('hex').slice(0,16);
}
function safePack(pack){
 return pack?.schema==='tk-b-axis-ex-observations/v1'&&
   pack.license_status===Ex.APPROVAL&&pack.redistribution_approved===true&&pack.riders&&
   (!pack.license_expires_at||Date.parse(pack.license_expires_at)>Date.now());
}
function eligible(p,asOf){
 if(!validForecast(p))return false;
 const start=Date.parse(p.cutoff),saved=Date.parse(p.saved_at);
 return Number.isFinite(start)&&Number.isFinite(saved)&&saved<=asOf&&
   asOf<start-2*60000&&start<asOf+12*3600000;
}
function versions(race,pack,asOf){
 const first=Brain.build(race,{exAsOf:asOf});
 const second=Brain.build(race,{exPack:pack,exAsOf:asOf});
 const third=Brain.build(race,{exPack:pack,exAsOf:asOf,transitionMode:'physical_v2'});
 const baseline=Shadow.select(first),withEx=Shadow.select(second),withPhysical=Shadow.select(third);
 if(baseline.length!==Shadow.TICKETS||withEx.length!==Shadow.TICKETS||withPhysical.length!==Shadow.TICKETS)return null;
 const applied=Object.entries(second.profiles)
   .filter(([,p])=>p.ex_used>0||p.ex_context_used>0)
   .map(([no,p])=>({no:Number(no),source_url:p.ex_source_url,
     collected_at:p.ex_collected_at||null,metrics:p.ex_used||0,
     contexts:p.ex_context_used||0,comparisons:p.ex_context_comparisons||[]}))
   .sort((a,b)=>a.no-b.no);
 if(!applied.length)return null;
 return {baseline,ex:withEx,physical:withPhysical,delta:Shadow.diff(baseline,withEx),physical_delta:Shadow.diff(withEx,withPhysical),
    applied,ex_count:applied.reduce((n,x)=>n+x.metrics,0),
    rank_heads:{baseline:first.tickets.slice(0,5).map(t=>t.trio[0]),
      ex:second.tickets.slice(0,5).map(t=>t.trio[0])}};
}
function inputs(dir,date){
 const target=path.join(dir,'lab_history');
 if(!fs.existsSync(target)||!History.dates(target).includes(date))return [];
 const rows=History.load(target,date,{withResults:false}).predictions;
 const best=new Map();
 for(const row of rows){
   if(!validForecast(row))continue;
   const old=best.get(row.race_id);
   if(!old||Date.parse(row.saved_at)>Date.parse(old.saved_at))best.set(row.race_id,row);
 }
 return [...best.values()].sort((a,b)=>Date.parse(a.cutoff)-Date.parse(b.cutoff)||a.race_id.localeCompare(b.race_id));
}
function freeze(data=path.join(ROOT,'data'),asOf=Date.now(),opts={}){
 const started=typeof asOf==='number'?asOf:Date.parse(asOf),date=jst(started);
 if(!Number.isFinite(started))throw Error('FORECAST_TIME_INVALID');
 const modelId=opts.modelId||model(),limit=Math.min(20,Math.max(1,Number(opts.maxRaces)||12));
 const packPath=path.join(data,'ex_approved','latest.json');
 if(!fs.existsSync(packPath))return {saved:0,reason:'ex_not_found'};
 const pack=JSON.parse(fs.readFileSync(packPath,'utf8'));
 if(!safePack(pack))return {saved:0,reason:'ex_rights_or_data'};
 let saved=0,scanned=0,errors=0,unchanged=0,covered=0;
 const dates=[date,jst(started+86400000)];
 const root=path.join(data,'ex_roi','forecasts');
 for(const day of dates){
  for(const p of inputs(data,day)){
   if(saved>=limit)break;
   if(!eligible(p,started))continue;
   const digest=sha(p.race_id+'|'+modelId),folder=path.join(root,day),file=path.join(folder,digest+'.json');
   if(fs.existsSync(file))continue;
   scanned++;
   try{
    const forecast=versions(p.input,pack,started);
    if(!forecast){unchanged++;continue;}
    covered++;
    if(forecast.delta.same)unchanged++;
    const savedAt=Date.now();
    if(!(savedAt<Date.parse(p.cutoff)-2*60000))continue;
    const capture=new Date(started).toISOString();
    const record={schema:'tk-ex-roi-ab-forecast/v1',model_id:modelId,
      source_model:Brain.VERSION,
      race_id:p.race_id,date:p.input.date,saved_at:new Date(savedAt).toISOString(),
      as_of:capture,cutoff:p.cutoff,
      baseline_source_saved_at:p.saved_at,
      baseline_source_model:p.model_id,
      baseline_source_hash:sha(JSON.stringify(p.input)),
      identity:p.identity,
      input:p.input, // frozen public racecard, not results
      tickets_per_arm:Shadow.TICKETS,
      applied:forecast.applied,observed_ex_metrics:forecast.ex_count,
      baseline:forecast.baseline,ex:forecast.ex,physical:forecast.physical,
      delta:forecast.delta,physical_delta:forecast.physical_delta,
      policy:'research-only; three equal-stake eight-ticket simulations, no automatic wagering'};
    fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(file,JSON.stringify(record)+'\n',{flag:'wx'});
    saved++;
   }catch(e){
    if(e.code==='EEXIST')continue;
    errors++;if(errors<4)console.error('EX_AB_FREEZE_ERROR '+p.race_id+' '+e.message);
   }
  }
 }
 const result={schema:'tk-ex-roi-freeze-status/v1',last_run:new Date().toISOString(),
   model_id:modelId,saved,scanned,covered,unchanged,errors,
   timestamp_policy:'original public forecast and WINTICKET observations must both predate the frozen EX A/B prediction and race start',
   price_policy:'not an EV model, no buy decision'};
 const outDir=path.join(data,'ex_roi');
 fs.mkdirSync(outDir,{recursive:true});
 fs.writeFileSync(path.join(outDir,'freeze_status.json'),JSON.stringify(result,null,2)+'\n');
 return result;
}
if(require.main===module){
 const n=Number(process.argv[2]||12);
 try{console.log('EX_AB_FREEZE '+JSON.stringify(freeze(path.join(ROOT,'data'),Date.now(),{maxRaces:n})))}
 catch(e){console.error('EX_AB_FREEZE_FATAL '+e.message);process.exitCode=1;}
}
module.exports={model,eligible,versions,inputs,freeze,safePack};
