'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const E=require('../../js/line/evaluation.js'),A=require('../../js/results-audit.js'),P=require('../../js/model-provenance.js'),T=require('../../js/line/tickets.js'),S=require('../../js/line/sensitivity.js'),Report=require('../../scripts/line-evaluate.cjs');
const race={date:'2098-10-31',venue:'合成会場',race_no:1,start:'12:00',source:{mode:'live-public-feed',generated_at:'2098-10-31T00:00:00Z'},riders:Array.from({length:7},(_,i)=>({no:i+1,name:'合成選手'+(i+1),meta:{rider_id:String(i+1)}}))};
const input={race,as_of:'2098-10-31T01:00:00Z',cutoff:'2098-10-31T03:00:00.000Z'};
const out={mode:'pre-race',version:'test-v1',generated_at:'2098-10-31T01:00:01Z',input,provenance:{input_sha256:P.sha256(input),input_as_of:input.as_of,cutoff:input.cutoff,model:{model_id:'LINE-test-v1'}},decision:{axis:'interaction'},main:{finish:{pair:[1,2]}},tickets:[{key:'1-2-3',trio:[1,2,3],mode:'synthetic'}]};
const record={schema:'tk-keirin-line-frozen/v1',race_id:A.raceKey(race),saved_at:'2098-10-31T01:00:02Z',out};
const observed={race_id:record.race_id,race,identity:A.identity(race),source_updated_at:'2098-10-31T03:01:00Z',collected_at:'2098-10-31T03:02:00Z',combos:[{key:'1-2-3',trio:[1,2,3],payout:1000}]};
const clone=x=>structuredClone(x);let n=0;function equal(a,b){assert.deepEqual(a,b);n++;}
const before=JSON.stringify(record),success=E.evaluate(record,observed);equal(success.hit,true);equal(success.main_pair_hit,true);equal(success.story_verified,false);equal(JSON.stringify(record),before);const hashed={...clone(record),output_sha256:P.sha256(record.out)};equal(E.evaluate(hashed,observed).hit,true);hashed.out.tickets[0]={key:'1-2-4',trio:[1,2,4]};equal(E.evaluate(hashed,observed).status,'excluded');equal(E.evaluate(record).status,'pending');
for(const change of [x=>x.out.mode='historical-replay',x=>x.saved_at=input.cutoff,x=>x.out.input.as_of='2098-10-31T02:00:00Z',x=>x.out.input.race.riders[0].name='変更',x=>x.out.tickets.push(x.out.tickets[0]),x=>x.out.tickets[0].trio=[1,1,2],x=>x.out.provenance.model.model_id='',x=>x.out.generated_at='2098-10-31T04:00:00Z']){const bad=clone(record);change(bad);equal(E.evaluate(bad,observed).status,'excluded');}
for(const change of [x=>x.race.start='12:01',x=>x.identity[0][1]='別選手',x=>x.source_updated_at=input.cutoff,x=>x.combos=[{key:'1-1-2',trio:[1,1,2]}],x=>x.race_id='wrong',x=>x.race.riders[0].meta.rider_id='別人']){const bad=clone(observed);change(bad);equal(E.evaluate(record,bad).status,'excluded');}
for(const [trio,category] of [[[4,2,3],'1着候補漏れ'],[[1,4,3],'1・2着の組合せ漏れ'],[[1,2,4],'3着候補漏れ']]){const o=clone(observed);o.combos=[{key:trio.join('-'),trio}];equal(E.evaluate(record,o).category,category);}
const deadheat=clone(observed);deadheat.combos.push({key:'1-3-2',trio:[1,3,2]});equal(E.evaluate(record,deadheat).hit,true);
const summary=E.summarize([{model_id:'one',evaluation:success},{model_id:'two',evaluation:{...success,hit:false}},{evaluation:{status:'pending'}}]);equal(summary.by_model.one.hits,1);equal(summary.by_model.two.hits,0);equal(summary.evaluated,2);equal(summary.pending,1);
function h(id,pair,thirds,score=1){return {id,score,audit:{passed:true},finish:{pair,mode:'合成決着',thirds:thirds.map(no=>({no,reason:'合成進路の裏付け'}))},scenes:[{events:[{action:'pass',reason:'合成の独立した展開理由'}]}]};}
const main=h(1,[1,2],[3,4,5,6,7]),alternatives=[h(2,[2,1],[3,4,5,6,7]),h(3,[3,1],[2,4,5,6,7]),h(4,[1,2],[3,4]),h(5,[7,6],[5],.1)],tickets=T.generate(main,alternatives);
equal(tickets.tickets.length,12);equal(tickets.policy.fixed_count,false);equal(tickets.tickets.find(t=>t.key==='1-2-3').supporting_hypotheses,[1,4]);equal(tickets.policy.reviews.at(-1).accepted,false);equal(T.generate(h(1,[1,2],[3]),[]).tickets.length,1);
// Close-finish variations must be conditional on the same 4C state, not
// synthetic alternative race stories or hard-coded permutations.
const vv={id:71,score:2,audit:{passed:true},detached:[],riderBurden:{},burden:{A:0},defenses:[{action:'block'}],
 outside:{id:'B',from:1,kind:'short',progress:'前団に接近',anchor:'A'},secondary:null,
 scenes:Array.from({length:6},(_,i)=>i===4?{phase:'最終3～4コーナー',control:'A',
  groups:[{id:'A',lane:0,members:[1,2,3]},{id:'B',lane:1,attack:true,members:[4,5]}],
  positions:Object.fromEntries(Array.from({length:7},(_,j)=>[j+1,{band:j===3?'outside':'inner',ordinal:j===3?2:j}]))}:
  {events:[]}),
 finish:{pair:[2,1],mode:'番手差し',leaderStrength:.68,followStrength:.69,thirds:[{no:3,reason:'3番手の追走'},{no:4,reason:'外で接近'}]}};
const vInput={race:{riders:Array.from({length:7},(_,i)=>({no:i+1}))},
 features:Object.fromEntries(Array.from({length:7},(_,i)=>[i+1,{ability:{value:.70,basis:'力量比較'},finish:{value:i===2?.84:.71,basis:'直線比較'},makuri:{value:i===3?.90:.61,basis:'捲り比較'},inside:{value:.60,basis:'内進路比較'}}]))};
const vCandidates=T.variations(vv,vInput);
equal(vCandidates.some(t=>t.trio[0]===2&&t.trio[1]===4&&t.variation.kind==='same-corner'),true);
equal(vCandidates.some(t=>t.trio[0]===3&&t.trio[1]===2),true);
const withoutOutside=T.variations({...vv,outside:null},vInput);
equal(withoutOutside.some(t=>t.trio[0]===2&&t.trio[1]===4),false);
const withoutThirdRoute=T.variations({...vv,defenses:[]},vInput);
equal(withoutThirdRoute.some(t=>t.trio[0]===3&&t.trio[1]===2),false);
equal(vCandidates.every(t=>t.reason&&t.variation.source_hypothesis===vv.id),true);
const vOutput=T.generate(vv,[],vInput);
equal(vOutput.tickets.length<=12,true);equal(vOutput.tickets.some(t=>t.group==='variation'),true);
equal(vOutput.tickets.every(t=>new Set(t.trio).size===3),true);

const sm={id:1,axes:{a:1,b:0},finish:{pair:[1,2]}},sr={id:2,axes:{a:0,b:1.5},finish:{pair:[3,4]}},weights={a:2,b:1},review=S.review(sm,[sm,sr],weights);
equal(review.thresholds.find(t=>t.axis==='a').boundary,1.5);equal(review.scenarios.find(t=>t.axis==='a'&&t.factor===.5).winner,2);equal(review.scenarios.find(t=>t.axis==='a'&&t.factor===1.5).winner,1);
for(const threshold of review.thresholds){const w={...weights,[threshold.axis]:threshold.boundary};equal(Math.abs(Object.keys(w).reduce((sum,k)=>sum+(sm.axes[k]-sr.axes[k])*w[k],0))<1e-10,true);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'line-audit-')),line=path.join(dir,'line'),lab=path.join(dir,'lab');fs.mkdirSync(path.join(line,race.date),{recursive:true});fs.mkdirSync(lab);
const hash=crypto.createHash('sha256').update(record.race_id+'|'+out.provenance.model.model_id).digest('hex');fs.writeFileSync(path.join(line,race.date,hash+'.json'),JSON.stringify(record));fs.mkdirSync(path.join(lab,race.date));fs.writeFileSync(path.join(lab,race.date,'results.json'),JSON.stringify({results:[observed]}));const saved=fs.readFileSync(path.join(line,race.date,hash+'.json'),'utf8'),report=Report.report(line,lab,'2098-11-01T00:00:00Z');equal(report.summary.hits,1);equal(fs.readFileSync(path.join(line,race.date,hash+'.json'),'utf8'),saved);equal(JSON.stringify(report).includes('合成選手'),false);equal(Report.report(path.join(dir,'absent'),lab).summary.evaluated,0);fs.rmSync(dir,{recursive:true});
const Input=require('../../js/line/input.js'),sample=require('../../race_sample.json'),wind={kind:'wind',verified:true,source_url:'https://example.org/synthetic',published_at:'2026-10-30T00:00:00Z',collected_at:'2026-10-30T00:00:01Z',venue:'別会場',speed_mps:5,home_direction:'headwind'};equal(Input.prepare({...sample,conditions:{observations:[wind]}},{},Date.parse('2026-10-30T00:01:00Z')).race.conditions.observations.length,0);
equal(/require\([^)]*evaluation/.test(fs.readFileSync('js/line/engine.js','utf8')),false);
console.log(`PASS LINE audit: ${n} checks; frozen timestamps, input identity, no retrospective results, model isolation, variable tickets and algebraic reversal boundaries`);
