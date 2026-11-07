'use strict';
// Development-only retrospective test. Frozen pre-race inputs, hindsight B supplied
// only in oracle mode. Results and payouts are never given to the predictor.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const B=require('../js/b-axis/engine.js'),Baseline=require('../js/b-axis/engine-v02.js'),LineInput=require('../js/line/input.js');
const fixture=JSON.parse(fs.readFileSync(path.join(root,'research/b-axis/pilot_2026_11_06.json'),'utf8'));
const evaluation=JSON.parse(fs.readFileSync(path.join(root,'data/lab_evaluation.json'),'utf8'));
const byRace=new Map(evaluation.rows.filter(r=>r.date===fixture.date).map(r=>[r.race_id,r]));
const limits=[3,5,8,10],empty=()=>Object.fromEntries(limits.map(n=>[n,{n:0,hit:0,pairHit:0,tickets:0,cost100:0,payout100:0}]));
const oracle=empty(),normal=empty(),legacy=empty(),baselineOracle=empty(),baselineNormal=empty(),examples=[],errors=[],observations=[];
let count=0,bCorrect=0,sourceUnverified=0,lineupMismatch=0;
function record(bucket,picks,targets,payout){
 const pair=targets[0].slice(0,3);
 for(const n of limits){
  const keys=picks.slice(0,n),s=bucket[n];s.n++;s.tickets+=keys.length;s.cost100+=keys.length*100;
  if(keys.some(k=>targets.includes(k))){s.hit++;if(Number.isFinite(payout))s.payout100+=payout;}
  if(keys.some(k=>k.slice(0,3)===pair))s.pairHit++;
 }
}
for(const observed of fixture.races){
 const row=byRace.get(observed.race_id);
 if(!row?.history_url||!row.result?.combos?.length){errors.push({id:observed.race_id,reason:'missing frozen prediction or outcome'});continue;}
 const filename=path.resolve(root,row.history_url);
 if(!filename.startsWith(path.join(root,'data/lab_history')+path.sep)){errors.push({id:observed.race_id,reason:'invalid history location'});continue;}
 try{
  const p=JSON.parse(fs.readFileSync(filename,'utf8'));
  const start=Date.parse(p.input.date+'T'+p.input.start+':00+09:00');
  if(p.race_id!==observed.race_id||!p.pre_race||!(Date.parse(p.saved_at)<start)||p.saved_at!==row.saved_at)throw Error('no frozen pre-race proof');
  if(p.input.riders.length!==observed.runners||!p.input.riders.some(x=>x.no===observed.b_no))throw Error('invalid field or B');
  const targets=row.result.combos.map(x=>x.key),actual=observed.finish.join('-');
  if(!targets.includes(actual))throw Error('B pilot finish disagrees with published result');
  const pay=row.result.combos.find(c=>c.key===actual)?.payout;
  const input=LineInput.prepare(p.input,{},Date.parse(p.saved_at));
  const line=input.race.lineup.find(l=>l.includes(observed.b_no));
  if(!line)throw Error('missing B in lineup');
  if(line.join('-')!==observed.published_b_line.join('-'))lineupMismatch++;
  if(input.race.source?.verified!==true)sourceUnverified++;
  // No result/finish/payout fields in either B.build call.
  const o=B.build(input,{bNo:observed.b_no,limit:10});
  const n=B.build(input,{limit:10});
  const oOld=Baseline.build(input,{bNo:observed.b_no,limit:10});
  const nOld=Baseline.build(input,{limit:10});
  const oPicks=o.tickets.map(t=>t.key),nPicks=n.tickets.map(t=>t.key),lPicks=p.chosen.map(t=>t.key);
  record(oracle,oPicks,targets,pay);record(normal,nPicks,targets,pay);record(legacy,lPicks,targets,pay);
  record(baselineOracle,oOld.tickets.map(t=>t.key),targets,pay);record(baselineNormal,nOld.tickets.map(t=>t.key),targets,pay);
  count++;if(n.b.bNo===observed.b_no)bCorrect++;
  const lineSet=new Set(line),f=observed.finish;
  observations.push({runners:observed.runners,bPlace:f.indexOf(observed.b_no)+1||4,bLineWins:lineSet.has(f[0]),bLinePair:lineSet.has(f[0])&&lineSet.has(f[1]),aiBHit:n.b.bNo===observed.b_no});
  examples.push({id:observed.race_id,runners:observed.runners,b:observed.b_no,actual,aiB:n.b.bNo,
    top3:oPicks.slice(0,3),top5:oPicks.slice(0,5),top10:oPicks,leaderWinPicks:o.tickets.filter(t=>t.trio[0]===observed.b_no).length,oldTop5:oOld.tickets.slice(0,5).map(t=>t.key),oldTop10:oOld.tickets.map(t=>t.key),
    distinctPair:new Set(o.tickets.map(t=>t.key.slice(0,3))).size,observedPayout:pay||null});
 }catch(e){errors.push({id:observed.race_id,reason:String(e.message||e)});}
}
for(const bucket of [oracle,normal,legacy,baselineOracle,baselineNormal])for(const s of Object.values(bucket)){
 s.roiPercent=s.cost100>0?Math.round(10000*s.payout100/s.cost100)/100:null;
 s.hitRate=s.n>0?Math.round(1000*s.hit/s.n)/10:null;
 s.pairHitRate=s.n>0?Math.round(1000*s.pairHit/s.n)/10:null;
 s.avgTickets=s.n>0?Math.round(100*s.tickets/s.n)/100:0;
}
const byRunners=Object.fromEntries([7,9].map(n=>{
 const a=observations.filter(o=>o.runners===n);
 return [n,{n:a.length,bFirst:a.filter(o=>o.bPlace===1).length,bTop3:a.filter(o=>o.bPlace<=3).length,
 bLineWins:a.filter(o=>o.bLineWins).length,bLinePair:a.filter(o=>o.bLinePair).length,bPredicted:a.filter(o=>o.aiBHit).length}];
}));
const summary={schema:'tk-baxis-retrospective/v1',model:B.VERSION,date:fixture.date,count,sourceUnverified,lineupMismatch,
 bCorrect,bRate:count?Math.round(1000*bCorrect/count)/10:null,byRunners,oracle,normal,legacy,baselineOracle,baselineNormal,
 warning:'Retrospective replay; model developed after the races. Oracle B is hindsight-only and cannot justify live ROI. Published result feed not independently verified, n=26 one date; block/detach rates are not observed.',examples,errors};
process.stdout.write('B_AXIS_EMPIRICAL '+JSON.stringify(summary)+'\n');
if(process.env.B_AXIS_REPORT_PATH){fs.mkdirSync(path.dirname(process.env.B_AXIS_REPORT_PATH),{recursive:true});fs.writeFileSync(process.env.B_AXIS_REPORT_PATH,JSON.stringify(summary,null,2)+'\n');}
if(count!==fixture.races.length||errors.length)process.exitCode=1;
