'use strict';
// Time-split, public RESULTS-derived context history; not original WINTICKET EX.
const fs=require('node:fs'),path=require('node:path');
const Context=require('../js/b-axis/ex-context.js');
const root=path.join(__dirname,'..');
const BASE='https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/';
const END='2026-11-07',MIN='2026-06-22',HOLDOUT='2026-10-16';
const AXES=Context.AXES;
const empty=()=>({n:0,first:0,second:0,third:0,top3:0});
function group(){return {population:Object.fromEntries(AXES.map(x=>[x,{}])),riders:{},nRaces:0,nRiders:0,
  byCars:{7:0,9:0},weatherRows:0,skipped:{girls:0,field:0,results:0,lineup:0}};}
function add(map,axis,key,place){
 const t=map?.[axis];if(!t||!key)return;
 const s=t[key]||=empty();s.n++;
 if(place>=0){s.top3++;s[place===0?'first':place===1?'second':'third']++;}
}
function parseRace(r){
 if(r.is_girls||![7,9].includes(r.entries?.length))return null;
 const lineup=new Map(),ids=new Set();
 for(const e of r.entries){
  const m=/^(\d+)-(\d+)$/.exec(String(e.line_position||''));
  const no=Number(e.car_number);
  if(!m||!Number.isInteger(no)||ids.has(no))return null;
  ids.add(no);
  const grp=Number(m[1]),idx=Number(m[2]);
  if(!lineup.has(grp))lineup.set(grp,[]);
  if(lineup.get(grp)[idx-1])return null;
  lineup.get(grp)[idx-1]=no;
 }
 const lines=[...lineup.values()];
 if(lines.some(x=>!x.length||x.some(y=>!Number.isInteger(y))))return null;
 return lines;
}
function observe(bucket,r){
 if(r.is_girls){bucket.skipped.girls++;return;}
 if(![7,9].includes(r.entries?.length)){bucket.skipped.field++;return;}
 const finish=r.result_combos?.[0]?.combo;
 if(!Array.isArray(finish)||finish.length!==3||new Set(finish).size!==3||finish.some(n=>!Number.isInteger(n))){bucket.skipped.results++;return;}
 const lineup=parseRace(r);
 if(!lineup){bucket.skipped.lineup++;return;}
 if(finish.some(n=>!lineup.flat().includes(n))){bucket.skipped.results++;return;}
 bucket.nRaces++;bucket.byCars[r.entries.length]++;
 const race={lineup,grade:r.grade,round_name:r.round_name,class:r.round_name,start:r.start_time,
   ex_context:{track_length:r.track_length,weather:null,weather_source_verified:false}};
 for(const e of r.entries){
  const rider={no:e.car_number,rider_id:e.rider_id,meta:{rider_id:e.rider_id}};
  const keys=Context.keys(race,rider),id=Context.idOf(rider),place=finish.indexOf(rider.no);
  if(!id)continue;
  bucket.riders[id]||=Object.fromEntries(AXES.map(axis=>[axis,{}]));
  for(const axis of AXES){
   const key=keys[axis];
   if(!key)continue;
   add(bucket.population,axis,key,place);
   add(bucket.riders[id],axis,key,place);
   if(axis==='weather')bucket.weatherRows++;
  }
  bucket.nRiders++;
 }
}
function compact(g){
 const riders=Object.fromEntries(Object.entries(g.riders).map(([id,values])=>[id,Object.fromEntries(
  Object.entries(values).map(([axis,keys])=>[axis,Object.fromEntries(Object.entries(keys)
   .filter(([,s])=>s.n>=3).map(([key,s])=>[key,s]))])
 )]).filter(([,value])=>Object.values(value).some(k=>Object.keys(k).length)));
 return {...g,riders};
}
async function main(){
 const idx=await (await fetch(BASE+'index.json',{signal:AbortSignal.timeout(16000)})).json();
 const dates=(idx.dates||[]).filter(x=>x>=MIN&&x<=END).sort();
 if(!dates.length)throw Error('no dates');
 const all=group(),train=group(),holdout=group(),missing=[];
 const concurrency=7;
 await Promise.all(Array.from({length:concurrency},async(_,slot)=>{
  for(let i=slot;i<dates.length;i+=concurrency){
   const date=dates[i];try{
    const res=await fetch(BASE+date+'.json',{signal:AbortSignal.timeout(15000)});
    if(!res.ok)throw Error('HTTP '+res.status);
    const doc=await res.json();
    if(doc.date!==date||!Array.isArray(doc.races))throw Error('invalid day');
    for(const race of doc.races){observe(all,race);observe(date<HOLDOUT?train:holdout,race);}
   }catch(e){missing.push({date,error:String(e.message||e)})}
  }
 }));
 if(missing.length)throw Error('archive incomplete '+JSON.stringify(missing.slice(0,5))+' total '+missing.length);
 const d={schema:'tk-b-axis-ex-context-history/v1',training_start:dates[0],training_end:dates.at(-1),
   train_end_exclusive:HOLDOUT,days:dates.length,source:BASE,
   provenance:{public_finishes_with_pre_race_context:true,actual_b_available:false,winticket_ex_metrics:false,
    weather_source_available:all.weatherRows>0,definition:'EX-equivalent self-aggregated contextual finish correlations, NOT licensed EX output',
    runner_selection:'male 7/9 racers with complete line position and result',pre_race_field_snapshot_unverified:true,
    lookahead_guard:'history unavailable when input race.date <= training_end'},
   population:all.population,riders:compact(all).riders,
   splits:{train:compact(train),holdout:compact(holdout)},
   summary:{nRaces:all.nRaces,nRiders:all.nRiders,byCars:all.byCars,weatherRows:all.weatherRows,
    riderCount:Object.keys(compact(all).riders).length,missingDates:missing.length}
 };
 const dest=path.join(root,'data/b_axis_ex_context.json');
 fs.writeFileSync(dest,JSON.stringify(d,null,2)+'\n');
 console.log('B_AXIS_EX_CONTEXT '+JSON.stringify({schema:d.schema,days:d.days,summary:d.summary,
  population:d.population,train:{nRaces:train.nRaces,riderCount:Object.keys(compact(train).riders).length},
  holdout:{nRaces:holdout.nRaces,riderCount:Object.keys(compact(holdout).riders).length}}));
}
main().catch(e=>{console.error('B_AXIS_EX_CONTEXT_ERROR '+(e.stack||e));process.exitCode=1;});
