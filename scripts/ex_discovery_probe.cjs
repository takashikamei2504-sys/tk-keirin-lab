'use strict';
const url='https://www.winticket.jp/keirin/racecard/';
(async()=>{
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'text/html'}});
 if(!response.ok)throw Error('HTTP '+response.status);
 const html=await response.text();if(html.length>8e6)throw Error('PAGE_TOO_LARGE');
 const paths=[...new Set([...html.matchAll(/(?:https:\/\/www\.winticket\.jp)?\/keirin\/([a-z]+)\/racecard\/(\d{10})\/(\d+)\/(\d+)/g)].map(m=>m[0]))];
 const href=html.match(/href=["'][^"']*racecard[^"']*["']/g)||[];
 console.log('INDEX_PROBE '+JSON.stringify({length:html.length,paths:paths.length,first:paths.slice(0,12),href_count:href.length,href_examples:href.slice(0,5),
 preloaded:html.includes('__PRELOADED_STATE__'),jst:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date())}));
})().catch(e=>{console.error('INDEX_PROBE_ERROR '+e.message);process.exitCode=1;});
