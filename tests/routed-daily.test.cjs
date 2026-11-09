'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Router=require('../js/routing/router.js'),H=require('../js/routing/history.js'),P=require('../js/model-provenance.js'),A=require('../js/results-audit.js'),E=require('../js/routing/evaluation.js'),D=require('../scripts/routed-daily.cjs'),F=require('./race-routing-fixtures.cjs');
const at=Date.parse('2040-01-01T00:00:00Z'),race=F.race(7,'A1'),out=Router.build(race,{}, {asOf:at}),rec=H.snapshot(out,new Date(at+1000).toISOString()),copy=x=>JSON.parse(JSON.stringify(x));
function observed(record=rec){const o=record.out,r=o.input;return {race_id:o.race_id,race:r,identity:A.identity(r),combos:o.tickets.slice(0,1).map(t=>({key:t.key,trio:t.trio,payout:12340})),source_updated_at:'2040-01-01T08:00:00Z',collected_at:'2040-01-01T08:01:00Z'};}
assert.equal(E.evaluate(rec).status,'pending');
let ev=E.evaluate(rec,observed());assert.equal(ev.status,'evaluated');assert.equal(ev.payout,12340);assert.equal(ev.stake,out.tickets.length*100);assert.equal(ev.hit,true);
let r=copy(rec);r.out.tickets[0].key='9-9-9';assert.equal(E.evaluate(r,observed()).status,'excluded');
r=copy(rec);r.saved_at=r.cutoff;assert.equal(E.evaluate(r,observed()).status,'excluded');
r=copy(rec);r.requested='physical';assert.equal(E.evaluate(r,observed()).status,'excluded');
let obs=observed();obs.race=copy(obs.race);obs.race.riders[0].name='別人';assert.equal(E.evaluate(rec,obs).status,'excluded');
obs=observed();obs.combos[0].payout=null;assert.equal(E.evaluate(rec,obs).status,'awaiting_payout');
obs=observed();obs.source_updated_at=rec.cutoff;assert.equal(E.evaluate(rec,obs).status,'excluded');
obs=observed();obs.combos=rec.out.tickets.slice(0,2).map((t,i)=>({key:t.key,trio:t.trio,payout:1000+i*100}));assert.equal(E.evaluate(rec,obs).payout,2100,'dead heat pays every winning ticket once');
assert.equal(E.evaluate(rec,{accounting_hold:'返還あり'}).status,'excluded');
let s=E.summarize([{saved_at:rec.saved_at,race_id:rec.race_id,evaluation:ev},{evaluation:{status:'pending'}},{evaluation:{status:'missed'}},{evaluation:{status:'awaiting_payout'}}]);assert.equal(s.evaluated,1);assert.equal(s.saved,1);assert.equal(s.roi,12340/ev.stake);assert.equal(s.without_max.roi,null);assert.equal(s.missed,1);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'routed-daily-'));
try{
 const day={date:race.date,generated_at:race.source.generated_at,races:[F.source(race)]};let calls=0;
 const build=r=>{calls++;return rec;},before=()=>at+2000;
 assert.equal(D.ingest(day,dir,{}, {now:before,build}).saved,1);assert.equal(D.ingest(day,dir,{}, {now:before,build}).saved,0);assert.equal(calls,1,'existing records never recomputed');
 const file=path.join(dir,day.date,D.name(rec.race_id)),original=fs.readFileSync(file,'utf8');
 let rep=D.report(dir,at+2000);assert.equal(rep.summary.saved,1);assert.equal(rep.summary.pending,1);assert.equal(rep.rows[0].engine,'physical');assert.equal(rep.by_category['A級_7'].saved,1);
 const after=()=>Date.parse('2040-01-01T08:01:00Z'),resultDay=copy(day);resultDay.generated_at='2040-01-01T08:00:00Z';resultDay.races[0].result_top3=rec.out.tickets[0].trio;resultDay.races[0].payout_trifecta=12340;
 D.ingest(resultDay,dir,{}, {now:after,build,settle:false});
 assert.equal(D.report(dir,after()).summary.pending,1,'forecast runs do not ingest published results');
 const coverageFile=path.join(dir,day.date,'coverage.json');
 const coverageBefore=fs.readFileSync(coverageFile,'utf8');
 D.ingest(resultDay,dir,{}, {now:after,build,capture:false});
 assert.equal(fs.readFileSync(coverageFile,'utf8'),coverageBefore,'result runs do not rewrite forecast coverage');
 rep=D.report(dir,after());assert.equal(rep.summary.hits,1);assert.equal(rep.summary.payout,12340);assert.equal(fs.readFileSync(file,'utf8'),original);
 resultDay.races[0].payout_trifecta=12000;D.ingest(resultDay,dir,{}, {now:after,build});assert.equal(D.report(dir,after()).summary.payout,12000,'result corrections update accounting only');
 const extra=F.source(F.race(7,'A3',2));resultDay.races.push(extra);D.ingest(resultDay,dir,{}, {now:after,build});rep=D.report(dir,after());assert.equal(rep.summary.missed,1);assert.equal(calls,1,'late races are never backfilled');
 resultDay.races[0].is_cancelled=true;D.ingest(resultDay,dir,{}, {now:after,build});assert.equal(D.report(dir,after()).summary.excluded,1);
 const bad=copy(day);bad.races.push(bad.races[0]);assert.throws(()=>D.ingest(bad,dir,{}, {now:before,build}),/重複/);
 const missing=copy(day);missing.races[0].entries[0].line_position=null;D.ingest(missing,path.join(dir,'missing'),{}, {now:before,build});assert.equal(D.report(path.join(dir,'missing'),at).by_category['A級_7'].error,1,'missing lineup retains assigned engine and category');
 const failDir=path.join(dir,'fail');D.ingest(day,failDir,{}, {now:before,build:()=>{throw Error('test timeout');}});assert.equal(D.report(failDir,at).summary.error,1);
 D.ingest(day,failDir,{}, {now:before,build});assert.equal(D.report(failDir,at).summary.saved,1,'failed forecasts retried before start');
 assert.equal(D.jstDate(Date.parse('2039-12-31T15:00:00Z')),'2040-01-01');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('routed daily: immutable capture, missing coverage, strict settlement, payout correction and category summaries passed');

(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'routed-schedule-'));
 try{
  const atNight=Date.parse('2040-01-01T15:35:00Z');
  assert.equal(D.resultSlot(atNight).raceDate,'2040-01-01');
  assert.equal(new Date(D.resultSlot(atNight).at).toISOString(),'2040-01-01T15:28:00.000Z');
  D.save(rec,dir);
  const now=()=>Date.parse('2040-01-01T12:00:00Z');
  const feed={date:race.date,generated_at:'2040-01-01T08:00:00Z',races:[F.source(race)]};
  const opts={dir,now,fetcher:async()=>feed,capture:false,scheduled:true};
  const status=()=>JSON.parse(fs.readFileSync(path.join(dir,'status.json'),'utf8'));
  await D.collect(opts);
  assert.equal(status().last_result_slot,null,'stale source leaves the result window open');
  feed.generated_at='2040-01-01T08:40:00Z';
  feed.races[0].result_top3=rec.out.tickets[0].trio;
  feed.races[0].payout_trifecta=12340;
  const evaluated=await D.collect(opts);
  assert.equal(evaluated.summary.evaluated,1,'a delayed regular run settles the missed evening window');
  assert.equal(status().last_result_slot,'2040-01-01T09:08:00.000Z');
  feed.races[0].payout_trifecta=13000;
  assert.equal((await D.collect(opts)).summary.payout,12340,'completed window does not settle again');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
