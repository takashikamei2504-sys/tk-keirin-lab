'use strict';
const assert = require('node:assert/strict');
const Legacy = require('../js/results-audit.js');
const {validForecast, latest, settle, summarize, compare} = require('../js/roi/audit.cjs');

const riders = Array.from({length:7}, (_, i) => ({no:i+1,name:String(i+1),meta:{rank:'A3'},style:'逃'}));
const input = {date:'2026-11-07',venue:'テスト',race_no:1,start:'15:00',riders,
  lineup:[[1,2,3],[4,5],[6,7]],source:{mode:'live-public-feed',generated_at:'2026-11-07T04:00:00Z'}};
const id = Legacy.raceKey(input);
const chosen = [[1,2,3],[1,3,2],[1,2,4]].map(trio => ({key:trio.join('-'),trio}));
const forecast = {race_id:id,model_id:'a',input,identity:Legacy.identity(input),
  saved_at:'2026-11-07T05:00:00Z',cutoff:'2026-11-07T06:00:00Z',pre_race:true,chosen};
const result = {race_id:id,race:input,identity:forecast.identity.filter(([no]) => no !== 4),
  withdrawn_cars:[4],source_updated_at:'2026-11-07T06:05:00Z',collected_at:'2026-11-07T06:06:00Z',
  combos:[{...chosen[0],payout:5000},{...chosen[1],payout:3000}]};
assert(validForecast(forecast));
assert(!validForecast({...forecast,saved_at:forecast.cutoff}));
assert.equal(latest([forecast,{...forecast,model_id:'b',saved_at:'2026-11-07T05:30:00Z'}])[0].model_id,'b');
assert.equal(settle(forecast,{...result,withdrawn_cars:[]}).status,'identity_or_time');
assert.equal(settle(forecast,{...result,combos:[{...chosen[0],payout:null}]}).status,'missing_payout');
const row = settle(forecast,result,{day:'初日'});
const stats = summarize([row]);
assert.equal(stats.stake,200);
assert.equal(stats.payout,8000);
assert.equal(stats.winning_tickets,2);
assert.equal(stats.refunded_tickets,1);
assert.equal(stats.trimmed[1],15);
assert.equal(stats.without_top_race,null);
assert.equal(row.grade,'チャレンジ');
assert.equal(row.day,'初日');
const loss = {...row,race_id:id+'loss',wins:[],points:3,cutoff:row.cutoff+1};
assert.equal(summarize([row,loss]).max_drawdown,300);
assert.equal(summarize([row,loss]).max_losing_streak,1);
assert.equal(compare([row],[loss]).races,0);
assert.equal(settle(forecast,{...result,combos:[],void:true}).refunded,3);
console.log('ROI audit: time, dedupe, dead heat, refunds, missing payouts and drawdown OK');
