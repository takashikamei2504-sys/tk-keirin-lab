'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const Patterns=require('../js/b-upset/patterns.cjs'),Engine=require('../js/b-upset/engine.cjs');
const Eval=require('../js/b-upset/evaluation.cjs'),Daily=require('../scripts/b-upset-daily.cjs');
const Router=require('../js/routing/router.js'),H=require('../js/routing/history.js'),Audit=require('../js/results-audit.js');
const F=require('./race-routing-fixtures.cjs'),B=require('../js/b-axis/engine.js'),Source=require('../scripts/b-upset-results.cjs');
const lines=[[1,2,3],[4,5,6],[7],[8,9]];
for(const [key,expected] of Object.entries({ '4-5-6':'A','4-1-5':'B','4-5-1':'C','1-4-5':'D','4-1-2':'E','1-4-2':'F','1-2-4':'G','7-4-1':'H','1-2-3':'Z'})){
  assert.equal(Patterns.classify(key.split('-').map(Number),lines,'L0','L1').pattern,expected);
}
for(const [trio,expected] of [[[7,4,1],'H1'],[[4,7,1],'H2'],[[1,7,4],'H3']]){
  const p=Patterns.classify(trio,lines,'L0','L1');assert.equal(p.subtype,expected);assert.equal(p.x[0].line_id,'L2');assert(p.x[0].solo);
}
for(const no of [7,9]){
  const lineup=no===7?[[1,2,3],[4,5],[6,7]]:lines;
  let n=0;for(let a=1;a<=no;a++)for(let b=1;b<=no;b++)for(let c=1;c<=no;c++)if(new Set([a,b,c]).size===3){
    const p=Patterns.classify([a,b,c],lineup,'L0','L1');assert(Object.hasOwn(Patterns.LABELS,p.pattern));
    if(no===7)assert.notEqual(p.pattern,'A');n++;
  }
  assert.equal(n,no===7?210:504);
}
const at=Date.parse('2040-01-01T00:00:00Z'),raw=F.race(7,'A1'),original=JSON.stringify(raw);
const o=Engine.build(raw,{asOf:at});assert.equal(JSON.stringify(raw),original);assert(o.scenarios.length>0);
assert(o.scenarios.every(s=>s.b_line!==o.ranking.favorite&&s.audit.passed&&s.phases.length===6));
assert.equal(o.ranking.market_rank,null);assert.equal(o.recommendation.tickets.length,0);
for(const view of [o.research.ad,o.research.expanded]){
 assert(view.length<=10);assert.equal(new Set(view.map(t=>t.key)).size,view.length);
 for(const t of view){assert.notEqual(t.pattern,'Z');const s=o.scenarios.find(s=>s.id===t.scenario_id);assert.equal(s.b_no,t.b_no);assert(B.Phases.audit({phases:s.phases.slice(0,4).concat(t.finish_phases),states:s.states,bNo:s.b_no},{complete:true}).passed);}
}
assert(o.research.ad.every(t=>'ABCD'.includes(t.pattern)));
assert.deepEqual(Engine.build({...raw,results:[7,6,5],payouts:{fake:100000}},{asOf:at}).research.expanded.map(t=>t.key),o.research.expanded.map(t=>t.key),'result fields are stripped at the boundary');
assert.throws(()=>Engine.build(raw,{asOf:Date.parse(o.cutoff)}),/発走後/);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'b-upset-'));
try{
 const parent=H.snapshot(Router.build(raw,{}, {asOf:at}),new Date(at+100).toISOString());
 const saved=Daily.freeze(parent,dir,{clock:()=>at+200});assert(saved.saved);
 const bytes=fs.readFileSync(saved.file,'utf8');assert.equal(Daily.freeze(parent,dir,{clock:()=>at+300}).reason,'existing');assert.equal(fs.readFileSync(saved.file,'utf8'),bytes);
 const record=JSON.parse(bytes);assert.equal(Eval.evaluate(record).status,'pending');
 const result={race_id:o.race_id,race:record.out.input,identity:Audit.identity(record.out.input),combos:[{key:'1-2-3',trio:[1,2,3],payout:5000}],source_updated_at:'2040-01-01T08:00:00Z'};
 assert.equal(Eval.evaluate(record,result).status,'evaluated');
 result.identity=result.identity.slice(1);assert.equal(Eval.evaluate(record,result).status,'excluded');
 record.out.research.ad=[];assert.equal(Eval.evaluate(record).status,'excluded');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
assert.deepEqual(Engine.selectValue(o,null,null,new Date(at).toISOString()),[]);
const ticket=o.research.expanded[0];
const quote={race_id:o.race_id,identity_verified:true,final:false,source_url:'https://www.winticket.jp/keirin/test/racecard/2039010101/1/1',updated_at:new Date(at).toISOString(),close_at:new Date(Date.parse(o.cutoff)-300000).toISOString(),odds:{[ticket.key]:100}};
const calibration={model_id:o.model.model_id,calibrated:true,lower_factor:.9,holdout_n:500,validation_roi:1.2,trim1_roi:1.1,training_end:'2039-01-01T00:00:00Z',source_url:'https://example.test/heldout',probabilities:{[ticket.key]:.02}};
assert.equal(Engine.selectValue(o,quote,calibration,new Date(at+100).toISOString()).length,1);
calibration.model_id='other-model';assert.equal(Engine.selectValue(o,quote,calibration,new Date(at+100).toISOString()).length,0);
const metric=Eval.metrics([{points:1,stake:100,payout:10000,net:9900,hit:true},{points:1,stake:100,payout:0,net:-100,hit:false}]);
assert.equal(metric.roi,50);assert.equal(metric.trim1,0);assert.equal(metric.max_drawdown,100);
const ident=[[1,'1','一郎'],[2,'2','二郎'],[3,'3','三郎']];
const table=b=>'<p>第1レース</p><table><tr><th>着</th><th>車番</th><th>選手名</th><th>S/B</th></tr>'+ident.map(([no,,name])=>'<tr><td>'+no+'</td><td>'+no+'</td><td>'+name+'</td><td>'+(no===2?b:'')+'</td></tr>').join('')+'</table>';
const expected=new Map([['2040-01-01:青森:1',{identity:ident,combos:[{key:'1-2-3',trio:[1,2,3]}]}]]);
assert.equal(Source.parse(table('B'),'2040-01-01','青森',expected,'2040-01-02T00:00:00Z')['2040-01-01:青森:1'].b_no,2);
assert.equal(Object.keys(Source.parse(table(''),'2040-01-01','青森',expected,'2040-01-02T00:00:00Z')).length,0);
console.log('B-UPSET: exhaustive 7/9 classification, physical paths, immutable cutoff, result isolation, EV model guard and explicit B-column extraction passed');
