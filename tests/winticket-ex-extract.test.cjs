'use strict';
const assert=require('node:assert/strict');
const Ex=require('../scripts/winticket_ex_extract.cjs');
const source='https://www.winticket.jp/keirin/yokkaichi/racecard/2026110548/4/12';
const state={tanStackQuery:{queries:[
  {queryKey:['keirin/race/odds','FETCH_KEIRIN_RACE_ODDS'],state:{data:{}}},
  {queryKey:['keirin/race/common','FETCH_KEIRIN_RACE'],state:{data:{
    race:{id:'sample-race'},entries:[{playerId:14838,number:3},{playerId:12345,number:6}],
    players:[{id:14838,name:'古性優作'},{id:12345,name:'別選手'}],
    records:[
      {playerId:14838,exSpurt:{percentage:62.5,attempts:8},exThrust:{percentage:0},
       exSplitLine:{percentage:40},exLeftBehind:{percentage:12.5,events:1,opportunities:8},
       exSnatch:{percentage:25},exCompete:{percentage:80},exUnclassified:{count:1}},
      {playerId:12345,exSpurt:{percentage:0},exLeftBehind:{percentage:100}}
    ]
  }}}
]}};
const html='<html><script>window.__PRELOADED_STATE__ = '+JSON.stringify(state)+';\nwindow.__CONFIG__={};</script></html>';
const out=Ex.extract(html,{source_url:source,captured_at:'2026-11-08T01:00:00.000Z'});
assert.equal(out.source_url,source);
assert.equal(out.riders.length,2);
assert.equal(out.riders[0].player_id,'14838');
assert.equal(out.riders[0].name,'古性優作');
assert.equal(out.riders[0].car_number,3);
assert.equal(out.riders[0].percentages.kamashi,62.5);
assert.equal(out.riders[0].percentages.tsuppari,0);
assert.equal(out.riders[0].percentages.chigiri,40);
assert.equal(out.riders[0].percentages.chigirarare,12.5);
assert.equal(out.riders[0].percentages.tobitsuki,25);
assert.equal(out.riders[0].percentages.seri,80);
assert.deepEqual(out.riders[0].explicitly_counted.chigirarare,{events:1,opportunities:8});
assert.equal(out.riders[0].explicitly_counted.kamashi,undefined,
  'attempts without a directly observed numerator must not imply a count');
assert.equal(out.riders[1].percentages.kamashi,0,'real zero rate must remain 0');
assert.deepEqual(out.key_status.additional_record_ex_keys,['exUnclassified']);
assert.equal(Ex.percentage({percentage:'75'}),null);
assert.equal(Ex.knownCounts({percentage:80,events:5,opportunities:4}),null);
assert.equal(Ex.knownCounts({events:0,opportunities:4}).events,0);
assert.deepEqual(Ex.knownCounts({percentage:40,succeeded:2,total:5}),{events:2,opportunities:5});
assert.equal(Ex.knownCounts({percentage:20,succeeded:2,total:5}),null);
assert.equal(Ex.knownCounts({percentage:0,succeeded:0,total:0}),null);
assert.throws(()=>Ex.extract('no preloaded state',{source_url:source}),/PRELOADED_STATE_MISSING/);
assert.throws(()=>Ex.extract(html,{source_url:'https://evil.test/keirin/x/racecard/x/1/1'}),/SOURCE_URL_INVALID/);
assert.throws(()=>Ex.extract('<script>window.__PRELOADED_STATE__ = {broken',{}),/PRELOADED_STATE_TRUNCATED/);
const Bridge=require('../scripts/winticket_ex_bridge.cjs');
const bridged=Bridge.bridge(out,'2026-11-08T02:00:00.000Z');
assert.equal(bridged.schema,'tk-b-axis-ex-observations/v1');
assert.equal(Object.keys(bridged.riders).length,1);
assert.deepEqual(bridged.riders['14838'].metrics.chigirarare,{events:1,opportunities:8});
assert.equal(bridged.riders['14838'].metrics.seri,undefined,'source without numerator/denominator must not enter B-AXIS');
assert.throws(()=>Bridge.bridge(out,'2026-11-08T00:59:59.000Z'),/PRE_RACE_SNAPSHOT_REQUIRED/);
console.log('WIN_EX_EXTRACT_TESTS_OK '+JSON.stringify(out.summary));
