'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Ready=require('../js/roi/readiness.cjs'),Calibration=require('../js/roi/calibration.cjs'),Odds=require('../js/roi/odds.cjs');
const Engine=require('../js/roi/engine.cjs'),Policy=require('../js/roi/policy.cjs');
const {decide}=require('../scripts/roi-decide.cjs');
const branches=Calibration.design([1,2,3,4,5,6,7],[['1-2-3',1]]);
const probabilities=[...Calibration.predict(branches,[1,1,1])];
const rows=Array.from({length:240},(_,i)=>{
 const day=1+Math.floor(i/12),date='2026-10-'+String(day).padStart(2,'0');
 return {race_id:String(i),saved_at:date+'T00:00:00Z',cutoff:date+'T01:00:00Z',trained_through:'2026-09-30T00:00:00Z',
 qualified:true,cars:7,probabilities,winners:['1-2-3']};
});
assert.equal(Ready.review(rows).eligible,true);
assert.equal(Ready.review(rows.slice(0,100)).eligible,false);
assert.equal(Ready.review(rows.map(r=>({...r,trained_through:'2027-01-01'}))).eligible,false);
assert.equal(Ready.review(rows.map(r=>({...r,qualified:false}))).eligible,false);
assert.equal(Ready.review([...rows,...rows]).groups[7].races,240);
assert.equal(Ready.review(rows.map(r=>({...r,winners:['7-6-5']}))).eligible,false);
const now=Date.parse('2026-11-07T09:00:00Z'),cutoff='2026-11-07T09:10:00Z',url='https://www.winticket.jp/keirin/test/racecard/2026110527/3/1';
const identity=Array.from({length:7},(_,i)=>[i+1,String(100+i),'試験'+i]);
const expected={race_id:'2026-11-07:試験:1',cutoff,race:{date:'2026-11-07',venue:'試験',number:1,start:'18:10'},identity};
const data={race:{id:'race',number:1,startAt:Date.parse(cutoff)/1000,closeAt:(now+300000)/1000,status:1,cancel:false,class:'A級',raceType:'予選'},
 schedule:{id:'2026110727',date:'20261107'},venues:[{id:'27',name:'試験'}],results:[],
 entries:identity.map(([number,playerId])=>({number,playerId,absent:false})),players:identity.map(([,id,name])=>({id,name}))};
const quote={finalOdds:false,oddsDelayed:false,oddsUpdatedAt:(now-60000)/1000,trifecta:probabilities.map(([key])=>({key:key.split('-').map(Number),raceId:'race',absent:false,unitPrice:100,odds:100}))};
const html=(d=data,q=quote)=>'window.__PRELOADED_STATE__ = '+JSON.stringify({tanStackQuery:{queries:[{queryKey:['FETCH_KEIRIN_RACE'],state:{data:d}},{queryKey:['FETCH_KEIRIN_RACE_ODDS'],state:{data:q}}]}})+'; window.__CONFIG__';
const snapshot=Odds.parse(html(),url,expected,new Date(now).toISOString());
assert.equal(Object.keys(snapshot.odds).length,210);
for(const q of [{...quote,finalOdds:true},{...quote,oddsDelayed:true},{...quote,oddsUpdatedAt:0},{...quote,trifecta:quote.trifecta.slice(1)}])assert.throws(()=>Odds.parse(html(data,q),url,expected,new Date(now).toISOString()));
assert.throws(()=>Odds.parse(html(),url,{...expected,identity:identity.slice(1)},new Date(now).toISOString()));
assert.throws(()=>Odds.parse(html(),url,expected,new Date(now+600000).toISOString()));
assert.throws(()=>Odds.parse(html({...data,race:{...data.race,status:2}}),url,expected,new Date(now).toISOString()));
async function main(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'roi-operation-')),file='a'.repeat(64)+'.json';
 try{
  const dir=path.join(root,'roi','forecasts','2026-11-07');fs.mkdirSync(dir,{recursive:true});
  const calibration={hypothesis_model:Engine.model.model_id,trained_through:'2026-11-07T00:00:00Z',beta:[1,1,1],eligible:true,
   readiness:{groups:{7:{qualified:true,bins:[{min:0,max:1,lower_factor:.8}]}}}};
  const model=Policy.model(calibration);
  const frozen={...expected,model,calibration,probability_validation:{},scores:[['1-2-3',1]],chosen:[{key:'1-2-3',trio:[1,2,3],evidence:[{reason:'試験'}]}]};
  fs.writeFileSync(path.join(dir,file),JSON.stringify(frozen));
  fs.writeFileSync(path.join(dir,'index.json'),JSON.stringify({model:model.model_id,rows:[{...expected,file,model:model.model_id}]}));
  const source={get:async()=>html(),links:()=>[{venue:'試験',number:1,url}],parse:Odds.parse};
  const result=await decide(root,()=>now,source);assert.equal(result.saved,1);
  const record=JSON.parse(fs.readFileSync(path.join(root,'roi','decisions','2026-11-07',file)));
  assert.equal(record.decision.status,'buy');assert.equal(record.decision.tickets.length,1);assert.equal(record.stake_per_ticket,100);
  assert.equal(record.decision.ev_thresholds['1.2'].length,1);
  const before=JSON.stringify(record);assert.equal((await decide(root,()=>now+1000,source)).saved,0);
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(root,'roi','decisions','2026-11-07',file)))),before);
  assert.equal((await decide(root,()=>now+600000,source)).saved,0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
 console.log('ROI operation: automatic gate opens/closes, leakage, dedupe, real-source schema, final/stale/identity guards, buy path and immutable decisions OK');
}
main().catch(e=>{console.error(e);process.exitCode=1;});