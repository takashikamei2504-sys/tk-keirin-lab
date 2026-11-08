'use strict';
const assert=require('node:assert/strict');
const C=require('../scripts/ex_winticket_live_collect.cjs');
const Extract=require('../scripts/winticket_ex_extract.cjs');
const Bridge=require('../scripts/winticket_ex_bridge.cjs');
const Ingest=require('../scripts/ex_approved_ingest.cjs');
const sourcePath='/keirin/yokkaichi/racecard/2026110548/4/12';
const at='2026-11-08T01:00:00.000Z';
const start='2026-11-08T11:30:00.000Z';
const race={
 race:{id:'race-1',number:12,startAt:Date.parse(start)/1000,weather:'晴'},
 players:[{id:'14838',name:'テスト選手'}],
 entries:[{playerId:'14838',number:3}],
 records:[{
  playerId:'14838',
  exSpurt:{total:5,succeeded:4,percentage:80},
  exThrust:{total:7,succeeded:2,percentage:28.6},
  exSplitLine:{total:10,succeeded:3,percentage:30},
  exLeftBehind:{total:10,succeeded:0,percentage:0},
  exSnatch:{total:8,succeeded:2,percentage:25},
  exCompete:{total:4,succeeded:3,percentage:75},
  linePositionFirst:{first:2,second:1,third:1,others:6,total:10},
  linePositionSecond:{first:1,second:2,third:3,others:4,total:10},
  lineSingleHorseman:{first:0,second:0,third:0,others:0,total:0},
  raceTypeFinal:{first:1,second:2,third:3,others:4,total:10},
  trackDistance400:{first:3,second:0,third:2,others:5,total:10},
  weatherSunny:{first:1,second:1,third:2,others:6,total:10},
  hourTypeNight:{first:3,second:2,third:1,others:4,total:10},
  weatherRainy:{first:1,second:1,third:1,others:1,total:5} // invalid total; must be discarded
 }]
};
const html='<script>window.__PRELOADED_STATE__ = '+JSON.stringify({tanStackQuery:{
  queries:[{queryKey:['keirin/race/common','FETCH_KEIRIN_RACE'],state:{data:race}}]}})+';</script>';
const extracted=Extract.extract(html,{source_url:'https://www.winticket.jp'+sourcePath,captured_at:at});
assert.equal(extracted.summary.players_with_ex,1);
assert.equal(Object.keys(extracted.riders[0].explicitly_counted).length,6);
assert.equal(extracted.riders[0].contextual.position.leader.top3,4);
assert.equal(extracted.riders[0].contextual.race_type.final.wins,1);
assert.equal(extracted.riders[0].contextual.bank_length['400'].opportunities,10);
assert.equal(extracted.riders[0].contextual.weather.sun.top3,4);
assert.equal(extracted.riders[0].contextual.time_band.night.wins,3);
assert.equal(extracted.riders[0].contextual.weather.rain,undefined);
const item={pathname:sourcePath,slug:'yokkaichi',venue:'四日市',no:12};
const row=C.recordFromHTML(html,item,at,'2026-11-08').row;
assert.equal(row.race_start,start);
assert.equal(row.source_context.weather,'晴');
assert.equal(row.date,'2026-11-08');
assert.equal(C.recordFromHTML(html,item,'2026-11-08T12:00:00Z','2026-11-08').skip,'after_race_start');
const bridged=Bridge.bridge(extracted,start);
assert.equal(bridged.riders['14838'].metrics.seri.events,3);
assert.equal(bridged.riders['14838'].contextual.position.leader.top3,4);
assert.equal(bridged.riders['14838'].contextual.time_band.night.wins,3);
const ref='user-attested-permission-2026-11-08';
const permit={approved:true,redistributionApproved:true,reference:ref};
const feed={
 schema:'tk-winticket-ex-authorized-feed/v1',
 license:{source:'WINTICKET',reference:ref,bulk_collection_approved:true,
   public_redistribution_approved:true,model_use_approved:true},
 snapshots:[row]
};
const ingested=Ingest.ingest(feed,{},permit);
assert.equal(ingested.latest.summary.valid_metrics,6);
assert(ingested.latest.summary.valid_context_buckets>=6);
assert.equal(ingested.latest.summary.covered_venues,1);
assert.equal(ingested.latest.race_contexts['2026-11-08:四日市:12'].weather,'晴');
const found=C.discover('<a href="'+sourcePath+'"></a><a href="'+sourcePath+'"></a>'+
  '<a href="/keirin/hofu/racecard/2026110763/2/1"></a><a href="/keirin/unknown/racecard/2026110500/1/1"></a>');
assert.equal(found.length,2);
assert.equal(found[0].venue==='四日市'||found[1].venue==='四日市',true);
assert.equal(Object.keys(C.VENUES).length,43);
assert.equal(C.approved({EX_BULK_RIGHTS_APPROVED:'true',EX_PUBLICATION_RIGHTS_APPROVED:'true',EX_MODEL_RIGHTS_APPROVED:'true',EX_RIGHTS_REFERENCE:ref}),true);
assert.equal(C.approved({EX_BULK_RIGHTS_APPROVED:'true'}),false);
console.log('WT_EX_ALL11_TESTS_OK '+JSON.stringify({
  riders:extracted.summary.players_with_ex,tactical:6,condition_categories:5,
  recognized_venues:Object.keys(C.VENUES).length,
  context_buckets:ingested.latest.summary.valid_context_buckets}));
