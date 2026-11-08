'use strict';
(async()=>{
const url='https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/2026-11-07.json';
const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
if(!response.ok)throw Error('HTTP '+response.status);
const day=await response.json();
const first=day.races.find(x=>x.entries?.length===9&&x.result_combos?.[0]?.combo);
const second=day.races.find(x=>x.entries?.length===7&&x.result_combos?.[0]?.combo);
for(const race of [first,second]){
console.log('B_AXIS_EX_RACE_SOURCE '+JSON.stringify({venue:race?.venue,date:day.date,keys:Object.keys(race||{}),selected:Object.fromEntries(Object.entries(race||{}).filter(([k,v])=>!['entries','result_combos'].includes(k))),rider:race?.entries?.[0]}).slice(0,9000));
}
})();