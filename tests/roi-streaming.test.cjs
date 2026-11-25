'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const Legacy=require('../js/results-audit.js'),P=require('../js/model-provenance.js'),LAB=require('../js/model-build.js');
const {readHistory,historyDays,report}=require('../scripts/roi-audit.cjs');
const {pairs,pairIterator}=require('../scripts/roi-research.cjs');
const Calibration=require('../js/roi/calibration.cjs'),{calibrate}=require('../scripts/roi-calibrate.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roi-stream-'));
try{
 for(const date of ['2026-11-07','2026-11-08']){
  const race={date,venue:'試験',race_no:1,start:'15:00',riders:[1,2,3,4,5,6,7].map(no=>({no,name:String(no),meta:{rank:'A3'}})),lineup:[[1,2,3],[4,5],[6,7]],source:{mode:'live-public-feed',generated_at:date+'T04:00:00Z'}};
  const cutoff=date+'T06:00:00Z',at=date+'T05:00:00Z',id=Legacy.raceKey(race),ticket={key:'1-2-3',trio:[1,2,3],explanation:'先行',reason:'先行',story_id:'s',hypothesis:7};
  const scenes=Array.from({length:6},(_,i)=>({phase:String(i),order:[1,2,3,4,5,6,7],action:'保持',groups:[]}));
  const lab={race_id:id,model_id:LAB.model_id,input:race,identity:Legacy.identity(race),saved_at:at,cutoff,pre_race:true,input_sha256:'hash',chosen:[ticket],story:{main:{id:'s',scenes,reading:'先行',audit:{passed:true}},alternatives:[]},unused_payload:'x'.repeat(1024*1024)};
  const result={race_id:id,race,identity:lab.identity,source_updated_at:date+'T06:05:00Z',collected_at:date+'T06:06:00Z',combos:[{key:'1-2-3',trio:[1,2,3],payout:3000}]};
  fs.mkdirSync(path.join(dir,'lab_history'),{recursive:true});fs.writeFileSync(path.join(dir,'lab_history',date+'.json'),JSON.stringify({schema:Legacy.SCHEMA,date,predictions:[lab],results:[result]}));
  const input={race,cutoff,as_of:at};const model_id='line-test';
  const out={mode:'pre-race',input,generated_at:at,provenance:{model:{model_id},input_sha256:P.sha256(input),input_as_of:at,cutoff},main:{id:7,scenes,audit:{passed:true},finish:{mode:'番手差し',pair:[2,1],thirds:[{no:3,reason:'追走'}]},score:1},alternatives:[],decision:{axis:'位置'},tickets:[ticket]};
  const record={schema:'tk-keirin-line-frozen/v1',race_id:id,saved_at:at,out};
  const folder=path.join(dir,'line_history',date);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,crypto.createHash('sha256').update(id+'|'+model_id).digest('hex')+'.json'),JSON.stringify(record));
 }
 const full=readHistory(dir),days=[...historyDays(dir)];assert.equal(days.length,2);assert.equal(days[0].lab.length,1);
 const outputs=pairs(full);assert.equal(outputs.length,2);assert.deepEqual(days.flatMap(d=>[...pairIterator(d)]),outputs);
 const compact=readHistory(dir,{withLineDetails:false,withLabDetails:false});assert.equal(compact.lab[0].unused_payload,undefined);assert.deepEqual(report(compact),report(full));
 const asOf=Date.parse('2026-11-16T00:00:00Z'),end=Date.parse('2026-11-16T00:00:00+09:00'),boundary=end-7*86400000;
 const rows=outputs.map(({lab,out})=>({start:Date.parse(lab.cutoff),result_at:Date.parse(full.results.get(lab.race_id).collected_at),winners:['1-2-3'],branches:Calibration.design(lab.input.riders.map(r=>r.no),out.scores)}));
 const fit=Calibration.train(rows,boundary),actual=calibrate(dir,asOf);for(const k of Object.keys(fit))assert.deepEqual(actual[k],fit[k],k);
 console.log('PASS daily streaming matches full-history pairing, calibration and compact accounting');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
