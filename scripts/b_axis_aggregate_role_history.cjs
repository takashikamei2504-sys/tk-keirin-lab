'use strict';
/* Aggregate public daily racing cards, published line_position and final trios.
 * NB final-back leader is NOT supplied by this feed. Never infer actual B from the
 * published line leader. These counts are line-ROLE / results associations ONLY.
 */
const fs=require('node:fs'),path=require('node:path');
const BASE='https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/';
const END='2026-11-07',TEST_START='2026-10-16';
const MIN='2025-11-08',fetchTimeout=16000;
async function read(date){
 const r=await fetch(BASE+date+'.json',{signal:AbortSignal.timeout(fetchTimeout)});
 if(!r.ok)throw Error(date+' HTTP '+r.status);
 const j=await r.json();
 if(j.date!==date||!Array.isArray(j.races))throw Error('invalid race file '+date);
 return j;
}
function roleBin(v){
 return v>=8?'plus8':v>=4?'plus4':v>=0?'plus0':v>=-4?'minus4':v>=-8?'minus8':'belowMinus8';
}
function roleRows(race) {
 const entries=race.entries||[],order=new Map(),all=entries.map(e=>Number(e.car_number));
 if(![7,9].includes(all.length)||new Set(all).size!==all.length||entries.some(e=>!Number.isFinite(e.competition_score)))return null;
 for(const e of entries){
  const position=String(e.line_position||'').match(/^(\d+)-(\d+)$/);
  if(!position)return null;
  const group=Number(position[1]),rank=Number(position[2]);
  if(!order.has(group))order.set(group,new Map());
  if(order.get(group).has(rank))return null;
  order.get(group).set(rank,e);
 }
 for(const g of order.values()){
  const ranks=[...g.keys()].sort((a,b)=>a-b);
  if(ranks[0]!==1||ranks.some((x,i)=>x!==i+1))return null;
 }
 return [...order.values()].sort((a,b)=>a.get(1).car_number-b.get(1).car_number)
   .map(g=>[...g.values()].sort((a,b)=>Number(a.line_position.split('-')[1])-Number(b.line_position.split('-')[1])));
}
function selectTrio(race){
 if(!Array.isArray(race.result_combos)||!race.result_combos.length)return null;
 const x=race.result_combos[0].combo;
 if(!Array.isArray(x)||x.length!==3||new Set(x).size!==3||x.some(n=>!Number.isInteger(n)))return null;
 return x;
}
const init=()=>({n:0,first:0,second:0,third:0,top3:0,plusScore:0,scoreSum:0});
function add(o,type,score){
 o.n++;o[type]++;if(['first','second','third'].includes(type))o.top3++;
 if(Number.isFinite(score)){o.scoreSum+=score;o.plusScore++;}
}
function empty(){
 return {races:0,eligible:0,skipGirls:0,skipOtherSize:0,skipNoResult:0,skipNoLineRole:0,
  runners:{7:0,9:0},byCarCount:{7:{races:0,leadersFirst:0,sameLine12:0,sameLine123:0},9:{races:0,leadersFirst:0,sameLine12:0,sameLine123:0}},lineSize:{},oneTwoSameLine:0,topThreeSameLine:0,oneThreeSameLine:0,
  thirdPlaceFromWinnerLine:0,leaderWins:0,rolePosition:{},followScoreGap:{},rider_roles:{},scoreRanks:{},
  firstTwoRelation:{sameLine:0,differentLine:0},observedBLeaderRows:0};
}
function observe(data,race){
 data.races++;
 if(race.is_girls){data.skipGirls++;return;}
 if(![7,9].includes(race.entries?.length)){data.skipOtherSize++;return;}
 const trio=selectTrio(race);
 if(!trio){data.skipNoResult++;return;}
 const lines=roleRows(race);
 if(!lines){data.skipNoLineRole++;return;}
 data.eligible++;const sz=race.entries.length;data.runners[sz]++;
 const ids=new Map();for(const line of lines)for(let i=0;i<line.length;i++)ids.set(line[i].car_number,{line,linePosition:i+1,rider:line[i]});
 if(trio.some(n=>!ids.has(n))){data.eligible--;data.skipNoResult++;return;}
 const w=trio.map(no=>ids.get(no)),same=(a,b)=>w[a].line===w[b].line;
 const car=data.byCarCount[sz];car.races++;if(w[0].linePosition===1)car.leadersFirst++;if(same(0,1))car.sameLine12++;if(same(0,1)&&same(1,2))car.sameLine123++;
 if(same(0,1)){data.oneTwoSameLine++;data.firstTwoRelation.sameLine++;}
 else data.firstTwoRelation.differentLine++;
 if(same(0,2)){data.oneThreeSameLine++;data.thirdPlaceFromWinnerLine++;}
 if(same(0,1)&&same(1,2))data.topThreeSameLine++;
 if(w[0].linePosition===1)data.leaderWins++;
 for(const line of lines){
  data.lineSize[line.length]??={lines:0,winningLine:0,top2SameLine:0,allTop3SameLine:0};
  const ls=data.lineSize[line.length];ls.lines++;
  if(w[0].line===line)ls.winningLine++;
  if(w[0].line===line&&w[1].line===line)ls.top2SameLine++;
  if(w.every(x=>x.line===line))ls.allTop3SameLine++;
  for(let i=0;i<line.length;i++){
   const rider=line[i],no=rider.car_number,place=trio.indexOf(no),type=place<0?'out':place===0?'first':place===1?'second':'third';
   const rel=i>0?Number(rider.competition_score)-Number(line[i-1].competition_score):0;
   const role=i===0?'leader':i===1?'second':'thirdPlus';
   const grade=sz+'-'+(race.grade||'unknown');
   const key=grade+'|'+role;
   data.rolePosition[key]??=init();add(data.rolePosition[key],type,Number(rider.competition_score));
   if(i>0){
    const b=sz+'|'+role+'|'+roleBin(rel),v=data.followScoreGap[b]??=init();
    add(v,type,Number(rider.competition_score));
    const id=String(rider.rider_id||'');
    if(id){
     const a=data.rider_roles[id]??={id,name:rider.rider_full_name||rider.rider_name||'',n:0,top3:0,first:0,second:0,third:0,trackRoleCount:0,scoreTotal:0};
     a.n++;a.trackRoleCount++;if(place>=0){a.top3++;a[place===0?'first':place===1?'second':'third']++;}
     a.scoreTotal+=Number(rider.competition_score);
    }
   }
  }
 }
}
async function main(){
 const idx=await (await fetch(BASE+'index.json',{signal:AbortSignal.timeout(fetchTimeout)})).json();
 const dates=(idx.dates||[]).filter(x=>x>=MIN&&x<=END).sort();
 if(!dates.length)throw Error('zero archive dates');
 const summaries={train:empty(),holdout:empty(),all:empty()},fail=[];
 const pool=Array.from({length:Math.min(8,dates.length)},async(_,id)=>{
  for(let n=id;n<dates.length;n+=8){
   const day=dates[n];
   try {
    const doc=await read(day),target=day<TEST_START?summaries.train:summaries.holdout;
    for(const race of doc.races){observe(target,race);observe(summaries.all,race);}
   } catch(e){fail.push({date:day,message:String(e.message||e)});}
  }
 });
 await Promise.all(pool);
 if(fail.length)throw Error('archive files not loaded: '+JSON.stringify(fail.slice(0,5))+' and '+fail.length+' total');
 const total=summaries.all;
 const minimal=Object.fromEntries(Object.entries(total.rider_roles).filter(([id,r])=>r.n>=5).map(([id,r])=>[id,{n:r.n,top3:r.top3,first:r.first,second:r.second,third:r.third,avgScore:Math.round(100*r.scoreTotal/r.n)/100}]));
 const result={
  schema:'tk-b-axis-role-history/v1',
  training_start:dates[0],training_end:dates.at(-1),
  number_of_days:dates.length,train_end_exclusive:TEST_START,
  source:'public keirin-app-data daily race cards: '+BASE,
  provenance:{actual_b_available:false,pre_race_line_roles_only:true,b_data_source:'none for broad archive',
    line_role_vs_result_only:true,top3_does_not_measure_following:true,raw_records_not_saved:true,
    public_results_not_independently_official_verified:true,coverage_not_one_year:true,
    timestamp_reconstruction_not_proven:true},
  train:{...summaries.train,rider_roles:undefined},holdout:{...summaries.holdout,rider_roles:undefined},
  all:{...total,rider_roles:undefined},
  rider_roles:minimal,errors:fail
 };
 const out=path.join(__dirname,'..','data/b_axis_role_history.json');
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
 const brief={schema:result.schema,period:[dates[0],dates.at(-1)],days:dates.length,n:total.eligible,rows7:total.runners[7],rows9:total.runners[9],
  skipped:[total.skipGirls,total.skipNoResult,total.skipNoLineRole],lineBySize:total.lineSize,
  oneTwoSameLine:total.oneTwoSameLine,threeSameLine:total.topThreeSameLine,leaderWins:total.leaderWins,byCarCount:total.byCarCount,riderCount:Object.keys(minimal).length,
  train:summaries.train.eligible,holdout:summaries.holdout.eligible,
  followBins:total.followScoreGap,errors:fail};
 console.log('B_AXIS_ROLE_ARCHIVE '+JSON.stringify(brief));
}
main().catch(e=>{console.error('B_AXIS_ROLE_ARCHIVE_ERROR '+String(e.stack||e));process.exitCode=1;});
