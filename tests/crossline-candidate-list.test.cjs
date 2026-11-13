'use strict';
const assert=require('node:assert/strict');
const Candidate=require('../js/crossline/candidate-list.js');
const Feed=require('../js/race-feed.js');
const date='2030-05-03',now=Date.parse(date+'T12:30:00+09:00');
const raw=(no,start)=>({venue:'福井',race_number:no,start_time:start,
 entries:[[1,'1-1'],[2,'1-2'],[3,'2-1'],[4,'2-2'],[5,'3-1'],[6,'3-2'],[7,'4-1']]
 .map(([car_number,line_position])=>({car_number,line_position,rider_id:String(6000+car_number),
  rider_full_name:'架空'+car_number,competition_score:100-car_number,running_style:car_number%2?'逃':'追',
  class_rank:car_number===7?'A2':'A1'}))});
const feed={date,generated_at:date+'T08:00:00+09:00',
 races:[raw(1,'15:00'),raw(2,'14:30'),raw(3,'15:30'),raw(4,'10:00')]};
const tickets=['1-3-2','1-3-4','1-5-2','1-5-3'];
const eligible={version:Candidate.VERSION,category:'A7',eligible:true,reason:'購入候補に該当',
 risk:{priority:true,percent:34.2,band:'上位25%'},pairs:[[1,3],[1,5]],
 candidate4:tickets,tickets:tickets.slice(),stake:400};
const skipped={...eligible,eligible:false,reason:'万車リスク上位25%の対象外',
 risk:{priority:false,percent:15.1},tickets:[],stake:0};
function frozen(s){
 const r=Feed.convert(s,feed);
 return {race_id:[date,s.venue,s.race_number].join(':'),date,venue:s.venue,race_no:s.race_number,start:s.start_time,
  source_generated_at:feed.generated_at,saved_at:date+(s.race_number===4?'T08:02:00+09:00':'T08:05:00+09:00'),
  identity:r.riders.map(x=>[x.no,x.meta.rider_id,x.name]),lineup:r.lineup,
  forecast:eligible};
}
const rows=[frozen(feed.races[0]),frozen(feed.races[3])];
assert.equal(Candidate.validSaved(rows[0],date),true);
assert.equal(Candidate.validSaved({...rows[0],identity:null},date),false);
assert.equal(Candidate.validForecast({...eligible,candidate4:['1-3-5',...tickets.slice(1)]}),true);
assert.equal(Candidate.validForecast({...eligible,candidate4:['1-6-2',...tickets.slice(1)]}),false,'pair/ticket mismatch');
assert.equal(Candidate.validForecast({...eligible,stake:800}),false);
let convertCalls=0,predictionCalls=0;
const convert=(s,f)=>{convertCalls++;return Feed.convert(s,f);};
const predict=(r)=>{predictionCalls++;return r.race_no===3?skipped:eligible;};
const call=overrides=>Candidate.assemble({date,feed,rows,now,weights:{},riskLib:{},riskModel:{},
 convert,predict,...overrides});
const a=call();
assert.deepEqual(a.upcoming.map(x=>x.race_no),[2,1],'earliest start first, not feed/source order');
assert.equal(a.upcoming[1].source,'frozen');
assert.equal(a.upcoming[0].source,'live');
assert.equal(a.concluded.length,1);
assert.equal(a.concluded[0].race_no,4);
assert.equal(a.skipped.length,1);
assert.equal(a.skipped[0].race_no,3);
assert.equal(a.points,8);
assert.equal(a.stake,800);
assert.equal(predictionCalls,2,'no new model call for frozen records');
assert.equal(convertCalls,4,'freeze verification is race-specific');
const b=call({now:Date.parse(date+'T15:10:00+09:00')});
assert.deepEqual(b.upcoming.map(x=>x.race_no),[]);
assert.deepEqual(b.concluded.map(x=>x.race_no),[4,1]);
assert.equal(b.stake,0);
const c=call({feed:{date,generated_at:date+'T17:10:00+09:00',races:feed.races},now:Date.parse(date+'T17:20:00+09:00')});
assert.equal(c.upcoming.length,0,'late feed never produces a live buying candidate');
const same=call({feed:{...feed,races:feed.races.map(s=>({...s,result_top3:[7,3,2],payout_trifecta:888800}))}});
assert.deepEqual(same.upcoming.map(x=>x.forecast.tickets),a.upcoming.map(x=>x.forecast.tickets),'results never affect tickets');
const changed=call({feed:{...feed,races:feed.races.map(s=>s.race_number===1?
 {...s,entries:s.entries.map(x=>x.car_number===1?{...x,rider_id:'wrong'}:x)}:s)}});
assert.ok(changed.invalid.some(x=>x.race_id.endsWith(':1')));
assert.ok(!changed.upcoming.some(x=>x.race_no===1),'changed lineup must not be actionable');
const fallback=call({feed:null});
assert.equal(fallback.feed_ok,false);
assert.deepEqual(fallback.upcoming.map(x=>x.race_no),[1]);
const mismatch=call({rows:[{...rows[0],lineup:[[1,2,3],[4,5,6,7]]},rows[1]]});
assert.ok(mismatch.invalid.some(x=>x.race_id.endsWith(':1')));
assert.ok(!mismatch.upcoming.some(x=>x.race_no===1));
const legacy=call({rows:[{...rows[0],identity:undefined,lineup:undefined},rows[1]]});
assert.equal(legacy.upcoming.find(x=>x.race_no===1)?.source,'live','old report without identities must be recalculated when pre-race feed exists');
console.log('PASS crossline candidate list: chronological, 4 tickets, total, source audit, late suppression, invalidation, fallback');
