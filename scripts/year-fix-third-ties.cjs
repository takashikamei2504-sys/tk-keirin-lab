#!/usr/bin/env node
'use strict';
/**
 * Correct three historic races with tied third place and two independently
 * published 3連単 payouts. The monthly CSV and daily archive each stored one
 * legitimate winning key; never call this a contradiction or pick one.
 * Validation links: oddspark Kawasaki 2026-08-21 11R; K-Dreams Matsudo
 * 2026-08-22 3R; keirin-mobile Tamano 2026-08-26 6R.
 *
 * Re-run exactly the unchanged 8 engines on the pinned historical source.
 * Only observed result combinations are corrected, not any input or wager.
 */
const fs=require('node:fs'),path=require('node:path');
const Feed=require('../js/race-feed.js'),Router=require('../js/routing/router.js');
const B=require('../js/b-upset/engine.cjs'),E=require('../js/b-upset/evaluation.cjs');
const Audit=require('../js/results-audit.js');
const SHA='4588ec938a2fec9e81216d3fd3423329805aa3d5';
const BASE='https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/'+SHA+'/';
const CASES=[
 {date:'2026-08-21',venue:'川崎',race_no:11,car_count:7,
  payouts:[['4-6-2',23100],['4-6-5',11790]],
  source:'https://sp.oddspark.com/keirin/SpRaceResultInfo.do?joCd=34&joCode=34&kaisaiBi=20260821&raceNo=11'},
 {date:'2026-08-22',venue:'松戸',race_no:3,car_count:9,
  payouts:[['5-3-7',180],['5-3-9',400]],
  source:'https://keirin.kdreams.jp/matsudo/raceresult/31202608220100/'},
 {date:'2026-08-26',venue:'玉野',race_no:6,car_count:7,
  payouts:[['4-3-1',1590],['4-3-5',900]],
  source:'https://www.keirin-mobile.jp/New/races/20260826/61/06/'}
];
const ENGINES=['auto','physical','causal','lab_v5','line','roi_coverage','b_upset_ad','b_upset_expanded'];
async function get(date){
 const r=await fetch(BASE+date+'.json',{signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error(date+' source not readable: HTTP '+r.status);
 const x=await r.json();
 if(x.date!==date || !Array.isArray(x.races))throw Error('Corrupt dated archive');
 return x;
}
function prepare(src,date){
 const raw=Feed.convert(src,{date,generated_at:''});
 raw.source.mode='historical-archive-replay';raw.source.generated_at='';
 return raw;
}
function tickets(raw,asOf){
 const x={};
 for(const e of ENGINES.filter(n=>!n.startsWith('b_upset'))){
  const b=Router.build(raw,{}, {asOf,engine:e});
  x[e]=b.tickets.map(t=>t.key);
 }
 const o=B.build(raw,{asOf,replay:true});
 x.b_upset_ad=o.research.ad.map(t=>t.key);
 x.b_upset_expanded=o.research.expanded.map(t=>t.key);
 return x;
}
async function main(){
 const docs=Object.fromEntries(await Promise.all([...new Set(CASES.map(x=>x.date))].map(async d=>[d,await get(d)])));
 const rows=[];
 for(const c of CASES){
  const day=docs[c.date];
  const selected=day.races.filter(x=>x.venue===c.venue&&x.race_number===c.race_no);
  if(selected.length!==1)throw Error('Ambiguous archived identity '+JSON.stringify(c));
  const src=selected[0];
  if(src.entries.length!==c.car_count)throw Error('Unexpected number of racers');
  const raw=prepare(src,c.date);
  const asOf=Date.parse(c.date+'T'+raw.start+':00+09:00')-600000;
  const original=Audit.result(src,day,new Date().toISOString());
  if(!original?.combos?.length)throw Error('No source-published baseline payout');
  const expected=new Map(c.payouts);
  for(const co of original.combos){
   if(!expected.has(co.key)||expected.get(co.key)!==co.payout)throw Error('Source baseline not a subset of confirmed twin results '+co.key);
  }
  if(original.combos.length!==1)throw Error('Daily source shape changed; pause to validate');
  const verified={combos:c.payouts.map(([key,payout])=>({key,payout,trio:key.split('-').map(Number)}))};
  const all=tickets(raw,asOf),r={race_id:original.race_id,date:c.date,venue:c.venue,race_no:c.race_no,
    payout_sources:[c.source,'https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/'+SHA+'/'+c.date+'.json'],
    original_published_combos:original.combos.map(v=>({key:v.key,payout:v.payout})),
    corrected_winning_keys:c.payouts.map(([key,payout])=>({key,payout})),
    engines:{}};
  for(const engine of ENGINES){
   const prev=E.settle(all[engine],original),correct=E.settle(all[engine],verified);
   if(prev.stake!==correct.stake||prev.points!==correct.points)throw Error('Bet list was altered');
   if(correct.payout<prev.payout)throw Error('Confirmed winning combination was dropped');
   r.engines[engine]={original:prev,corrected:correct,delta_payout:correct.payout-prev.payout};
  }
  rows.push(r);
 }
 const report={schema:'tk-keirin-third-place-ties-payout-corrections/v1',generated_at:new Date().toISOString(),
   source_revision:SHA,method:'Restore both verified third-place-dead-heat winning 3連単 combinations; hold wagers and all 8 engines constant',
   limitations:['3 externally checked race-result pages; historical retrospective evaluation, not frozen forecast',
   'No investment applied; this is corrected simulated settlement only'],
   races:rows,delta_by_engine:Object.fromEntries(ENGINES.map(e=>[e,rows.reduce((p,r)=>p+r.engines[e].delta_payout,0)]))};
 const out=path.resolve(__dirname,'../reports/year-race-type/equal-third-3race-corrections.json');
 fs.mkdirSync(path.dirname(out),{recursive:true});
 fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 console.log('CONFIRMED_DEAD_HEAT_SETTLEMENT',JSON.stringify(report.delta_by_engine,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
