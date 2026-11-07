'use strict';
const fs=require('node:fs'),path=require('node:path');
const B=require('../js/b-axis/engine.js');
const Input=require('../js/line/input.js');
const stored=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/lab_history/2026-11-08/p-285d0fbf519331a2e7b754f5e1f170800bb5e59136242d5baadd866d73b0c059.json'),'utf8'));
const x=Input.prepare(stored.input,{},Date.parse(stored.saved_at));
const original=x.race;
function summary(out){
 const riders=[8,3,5,9,7,4,2,6,1].map(no=>{
  const r=original.riders.find(z=>z.no===no);
  const s=out.b.states.find(z=>z.no===no);
  return {no,name:r?.name,score:r?.score,style:r?.style,ability:x.features?.[no]?.ability?.value,track:x.features?.[no]?.track?.value,trackBasis:x.features?.[no]?.track?.basis,sprint:x.features?.[no]?.sprint?.value,recency:x.features?.[no]?.track?.sources?.length,role:s?.role,gap:s?.gap,trackLabel:s?.track,remaining:s?.remaining,spent:s?.spent};
 });
 return {b:out.b.bNo,tactic:out.b.tactic,model:out.version,riders,passage:out.b.phases[3].events,top:out.tickets.slice(0,7).map(t=>({key:t.key,path:t.path,score:t.score}))};
}
const cases=[{bNo:8,tactic:'press'},{bNo:8,tactic:'hold'},{bNo:3,tactic:'surge'},{bNo:9,tactic:'press'},{}];
const results=[];
for(const opts of cases)try{results.push(summary(B.build(x,{...opts,limit:10})));}catch(e){results.push({opts,error:String(e.stack||e)})}
console.log('B_AXIS_YOKKAICHI '+JSON.stringify({snapshot:stored.saved_at,preRace:stored.pre_race,venue:original.venue,race:original.race_no,lineup:original.lineup,
riders:original.riders.map(r=>[r.no,r.name,r.style,r.score,r.meta?.class]),cases:results}));
const external=awaitPublicFeed().catch(e=>({error:String(e)}));
async function awaitPublicFeed(){
 const url='https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/2026-11-06.json';
 const response=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('HTTP '+response.status);
 const data=await response.json();
 const one=data.races?.find(r=>r.venue==='四日市'&&r.race_number===10);
 return {fileDate:data.date,totalRaces:data.races?.length,raceFields:Object.keys(one||{}),entryKeys:Object.keys(one?.entries?.[0]||{}),resultFields:{
  top3:one?.result_top3,combos:one?.result_combos,spec:one?.result_detail,result:one?.results,bMarker:one?.b
 }};
}
external.then(x=>console.log('B_AXIS_FEED_SCHEMA '+JSON.stringify(x)));

