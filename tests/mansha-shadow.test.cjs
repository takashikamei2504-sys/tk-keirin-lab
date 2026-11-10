'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Router=require('../js/routing/router.js'),H=require('../js/routing/history.js');
const P=require('../js/model-provenance.js'),Audit=require('../js/results-audit.js');
const F=require('./race-routing-fixtures.cjs'),D=require('../scripts/routed-daily.cjs');
const M=require('../js/mansha/shadow.cjs'),Daily=require('../scripts/mansha-shadow-daily.cjs');
const at=Date.parse('2040-01-01T00:00:00Z'),copy=x=>JSON.parse(JSON.stringify(x));
const race=F.race(7,'A1'),out=Router.build(race,{}, {asOf:at}),parent=H.snapshot(out,new Date(at+1000).toISOString());
assert(parent,'valid pre-race snapshot exists');
const sh=M.generate(parent,new Date(at+2000).toISOString());
assert(M.validate(sh,parent),'frozen shadow must be valid');
assert.equal(sh.modes.length,2);assert(sh.risk.probability>0&&sh.risk.probability<1);
assert.equal(sh.parent_output_sha256,parent.output_sha256);
for(const mode of sh.modes)for(const [id,n] of [['A',5],['B',10],['C',4]]){
 const v=mode.variants.find(x=>x.id===id);
 assert.equal(v.tickets.length,n,mode.name+'/'+id);
 assert(v.tickets.every(t=>new Set(t.trio).size===3));
 assert(v.tickets.every(t=>{
  const of=no=>race.lineup.findIndex(l=>l.includes(no));
  return of(t.trio[0])!==of(t.trio[1]);
 }));
}
assert.throws(()=>M.generate(parent,new Date(Date.parse(parent.cutoff)).toISOString()),/発走前/);
assert.equal(M.validate({...sh,sha256:'tampered'},parent),false);
const empty=new Map();
assert.deepEqual(M.pairRanks(race,empty,'baseline').map(x=>x.key),
 M.pairRanks(race,empty,'tactical').map(x=>x.key),'without six-phase evidence, no tactical bonus');
const ev=M.tacticEvidence(out,M.pairRanks?(()=>{
 const byNo=new Map();race.lineup.forEach((line,i)=>line.forEach((no,j)=>byNo.set(no,{line:i,role:j+1,size:line.length})));
 return {e:race.riders,byNo};
})():null);
assert(ev instanceof Map,'B-line evidence must be independently retrievable');
assert(sh.modes.every(x=>x.pair_rank.every(p=>p.a!==p.b)));
const origHash=sh.sha256;
const alt=copy(sh);alt.modes[0].variants[0].tickets[0].key='9-9-9';
assert.equal(M.validate(alt,parent),false,'frozen candidate must reject tampering');
const nine=F.race(9,'S1'),nineOut=Router.build(nine,{}, {asOf:at}),nineParent=H.snapshot(nineOut,new Date(at+1000).toISOString());
assert(nineParent);const s9=M.generate(nineParent,new Date(at+2000).toISOString());
assert(M.validate(s9,nineParent));
assert.deepEqual(s9.modes[0].variants.map(x=>x.tickets.length),[7,14,4]);
assert.match(s9.modes[0].variants[1].scope,/14点/);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mansha-shadow-'));
try{
 D.save(parent,dir);
 const check=Daily.run({root:dir,now:at+2000,captureEnabled:true,settleEnabled:false});
 assert.equal(check.summary.saved,1);
 assert.equal(check.summary.pending,1);
 assert.equal(check.summary.evaluated,0);
 const file=path.join(dir,race.date,'mansha_shadow',D.name(parent.race_id));
 const original=fs.readFileSync(file,'utf8');
 Daily.run({root:dir,now:at+8000,captureEnabled:true,settleEnabled:false});
 assert.equal(fs.readFileSync(file,'utf8'),original,'never overwrite original shadow');
 const oldEmpty=path.join(dir,'old');fs.mkdirSync(oldEmpty);
 D.save(parent,oldEmpty);
 const missed=Daily.run({root:oldEmpty,now:Date.parse(parent.cutoff)+5000,captureEnabled:true,settleEnabled:false});
 assert.equal(missed.summary.saved,0,'no retrospective shadow forecast may be generated after start');
 const src=F.source(race),won=sh.modes[0].variants[0].tickets[0].trio;
 src.result_top3=won;src.payout_trifecta=17890;
 const updated='2040-01-01T08:01:00Z',day={date:race.date,generated_at:updated,races:[src]};
 const observed=Audit.result(src,day,'2040-01-01T08:03:00Z');
 assert(observed&&observed.combos[0].key===won.join('-'));
 const resultsFile=path.join(dir,race.date,'results.json');
 fs.writeFileSync(resultsFile,JSON.stringify({[parent.race_id]:observed})+'\n');
 const settled=Daily.run({root:dir,now:Date.parse('2040-01-01T09:00:00Z'),captureEnabled:true,settleEnabled:true});
 assert.equal(settled.summary.evaluated,1);
 const evaluation=settled.rows[0].evaluation;
 assert.equal(evaluation.status,'evaluated');
 assert.equal(evaluation.by_mode.baseline.A.pair_hit,true,'separate first/second pair must be scored independently');
 assert.equal(evaluation.by_mode.baseline.A.hit,true);
 assert.equal(evaluation.by_mode.baseline.A.payout,17890);
 assert.equal(evaluation.by_mode.baseline.A.stake,500);
 assert.equal(settled.summary.by_variant['baseline/A'].pair_hits,1);
 assert.equal(settled.summary.by_variant['baseline/A'].roi_without_max,null,'single-race trimmed ROI has no denominator');
 assert.equal(fs.readFileSync(file,'utf8'),original,'outcomes must not modify frozen shadow');
 const unpaid=copy(observed);unpaid.combos[0].payout=null;fs.writeFileSync(resultsFile,JSON.stringify({[parent.race_id]:unpaid}));
 const payoutWait=Daily.report(dir,Date.parse('2040-01-01T09:01:00Z'));
 assert.equal(payoutWait.summary.awaiting_payout,1);
 const corrected=copy(observed);corrected.combos[0].payout=19500;fs.writeFileSync(resultsFile,JSON.stringify({[parent.race_id]:corrected}));
 assert.equal(Daily.report(dir,Date.parse('2040-01-01T09:02:00Z')).summary.by_variant['baseline/A'].payout,19500);
 assert.equal(fs.readFileSync(file,'utf8'),original);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('PASS mansha shadow: 7/9 cards, immutable before-start snapshots, phase evidence, revision and payout wait');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mansha-shadow-scheduled-'));
 try {
  const feed={date:race.date,generated_at:race.source.generated_at,races:[F.source(race)]};
  const current=at+2000;
  const res=await D.collect({dir,now:()=>current,fetcher:async day=>day===race.date?feed:null,
   capture:true,settle:false,scheduled:false,pack:{},build:()=>parent});
  assert.equal(res.summary.saved,1,'normal baseline must remain intact');
  const shadow=JSON.parse(fs.readFileSync(path.join(dir,'mansha_shadow_evaluation.json'),'utf8'));
  const status=JSON.parse(fs.readFileSync(path.join(dir,'status.json'),'utf8'));
  assert.equal(shadow.summary.saved,1,'routed collector must save the shadow in the same scheduled run');
  assert.equal(shadow.summary.pending,1);
  assert.equal(status.shadow_error,null,'shadow execution must not silently fail');
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
 console.log('PASS mansha shadow automatically integrated in routed collector');
})().catch(e=>{console.error(e);process.exitCode=1});
