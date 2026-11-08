'use strict';
const {extract}=require('./winticket_ex_extract.cjs');
(async()=>{
 const url='https://www.winticket.jp/keirin/yokkaichi/racecard/2026110548/4/12';
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(16000),headers:{accept:'text/html'}});
 if(!response.ok)throw Error('HTTP_'+response.status);
 const snapshot=extract(await response.text(),{source_url:url,captured_at:new Date().toISOString()});
 const axes={position:0,race_type:0,bank_length:0,weather:0,time_band:0};
 const keys={position:new Set(),race_type:new Set(),bank_length:new Set(),weather:new Set(),time_band:new Set()};
 for(const r of snapshot.riders)for(const [axis,rows] of Object.entries(r.contextual)){
  axes[axis]+=Object.keys(rows).length;
  Object.keys(rows).forEach(key=>keys[axis].add(key));
 }
 console.log('WT_EX11_SMOKE '+JSON.stringify({riders:snapshot.riders.length,
  tactical:snapshot.summary.count_pairs_accepted,context_buckets:axes,
  context_keys:Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,[...v]]))}));
})().catch(e=>{console.error('WT_EX11_SMOKE_ERROR '+e.message);process.exitCode=1;});
