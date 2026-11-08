'use strict';
const {extractPreloadedState}=require('./winticket_ex_extract.cjs');
(async()=>{
const url='https://www.winticket.jp/keirin/yokkaichi/racecard/2026110548/4/12';
const res=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(18000),headers:{accept:'text/html'}});
if(!res.ok)throw Error('HTTP_'+res.status);
const state=extractPreloadedState(await res.text());
const q=(state.tanStackQuery?.queries||[]).map(x=>({q:x.queryKey,d:x.state?.data}));
const brief=x=>Object.fromEntries(Object.entries(x||{}).map(([k,v])=>[k,
 Array.isArray(v)?'array['+v.length+']':v&&typeof v==='object'?'object{'+Object.keys(v).slice(0,15).join(',')+'}':typeof v]));
const race=q.find(x=>JSON.stringify(x.q).includes('FETCH_KEIRIN_RACE')&&Array.isArray(x.d?.records))?.d;
const first=race?.records?.[0];
console.log('WT_SHAPE '+JSON.stringify({
  queries:q.map(x=>({key:x.q,fields:Object.keys(x.d||{}).slice(0,28)})).slice(0,40),
  race:brief(race?.race),cup:brief(race?.cup),records:brief(first),
  player:brief(race?.players?.[0]),entry:brief(race?.entries?.[0]),
  race_schedule:brief(q.find(x=>JSON.stringify(x.q).includes('FETCH_KEIRIN_CUP_RACES'))?.d?.schedules?.[0]),
  date_keys:Object.keys(race?.race||{}).filter(k=>/date|time|start|close|at/i.test(k)),
 time_sample:race?.race?.startAt > 1e12?'milliseconds':race?.race?.startAt>1e9?'seconds':'other',
 start_jst:race?.race?.startAt?new Date(race.race.startAt*(race.race.startAt<1e12?1000:1)).toLocaleString('sv-SE',{timeZone:'Asia/Tokyo'}):null,
 index_date_sample: (q.find(x=>JSON.stringify(x.q).includes('FETCH_KEIRIN_CUP_RACES'))?.d?.schedules||[]).map(x=>x.date),
  ex_keys:Object.keys(first||{}).filter(k=>/^ex[A-Z]/.test(k)),
  context_candidates: Object.keys(race||{}).filter(k=>/condition|context|ex|stat|track|weather|race/i.test(k))
}));
})().catch(e=>{console.error('WT_SHAPE_ERROR '+e.message);process.exitCode=1;});
