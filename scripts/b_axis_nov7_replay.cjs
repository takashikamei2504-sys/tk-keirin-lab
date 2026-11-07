'use strict';
/*
 * B-AXIS November 7, 2026 after-the-fact replay.
 * Pre-start snapshot is frozen; model was developed after these races.
 * Actual B, finish and payout NEVER enter B.build.
 * Public Chariloto B classification is parsed directly from 1st result table
 * rather than inferring B from winner, published pre-race lineup or tactic.
 */
const fs=require('node:fs'),path=require('node:path');
const B=require('../js/b-axis/engine.js'),Old=require('../js/b-axis/engine-v02.js'),Input=require('../js/line/input.js');
const DATE='2026-11-07',ROOT=path.resolve(__dirname,'..');
const VENUE={四日市:48,熊本:87,高知:74,京王閣:27,小倉:81,福井:51,弥彦:21};
const ev=JSON.parse(fs.readFileSync(path.join(ROOT,'data/lab_evaluation.json'),'utf8'));
const study=JSON.parse(fs.readFileSync(path.join(ROOT,'data/b_axis_role_history.json'),'utf8'));
const ex=JSON.parse(fs.readFileSync(path.join(ROOT,'data/b_axis_ex_observations.json'),'utf8'));
const rows=ev.rows.filter(r=>r.date===DATE),period=[3,5,8,10];
function strip(html){return String(html).replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,'').trim()}
function parse(html){
 const out=new Map();
 for(const match of html.matchAll(/<section\s+id="race(\d+)"[^>]*>([\s\S]*?)(?=<section\s+id="race\d+"|$)/g)){
  const no=Number(match[1]),section=match[2];
  const body=section.match(/<table class="table-bordered-shade[^"]*"[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/);
  if(!body){out.set(no,{status:'result_table_missing'});continue;}
  const entries=[...body[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m=>{
   const td=[...m[1].matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/g)].map(z=>strip(z[1]));
   return {rank:td[0],no:Number(td[1]),name:td[2],sb:td[10]||'',cells:td.length};
  });
  const b=entries.filter(e=>/B/.test(e.sb)&&Number.isInteger(e.no)&&e.no>0).map(e=>e.no);
  const finish=entries.filter(e=>/^[123]$/.test(e.rank)).sort((a,b)=>Number(a.rank)-Number(b.rank)).map(e=>e.no);
  out.set(no,{status:b.length===1&&finish.length===3?'ok':'incomplete',b:b.length===1?b[0]:null,bCount:b.length,finish,
    rowCount:entries.length,missingB:b.length!==1,finishLabels:entries.slice(0,4)});
 }
 return out;
}
async function fetchVenues(){
 const all=new Map();
 await Promise.all(Object.entries(VENUE).map(async([name,no])=>{
  const url='https://www.chariloto.com/keirin/results/'+no+'/'+DATE;
  try {
   const r=await fetch(url,{signal:AbortSignal.timeout(19000),headers:{'User-Agent':'Mozilla/5.0 (compatible; KeirinLabResearch/1.0)','Accept-Language':'ja,en;q=0.8'}});
   if(!r.ok)throw Error('HTTP '+r.status);
   const parsed=parse(await r.text());
   all.set(name,{url,parsed});
  }catch(e){all.set(name,{url,error:String(e.message||e),parsed:new Map()});}
 }));
 return all;
}
function init(){return {n:0,hit:0,first:0,pair:0,ticketCount:0,spent100:0,returned100:0};}
function results(){return Object.fromEntries(period.map(k=>[k,init()]));}
function score(bucket,tickets,actual,payout){
 const trio=actual.split('-');
 for(const k of period){
  const t=tickets.slice(0,k),s=bucket[k];
  s.n++;s.ticketCount+=t.length;s.spent100+=t.length*100;
  if(t.some(x=>x===actual)){s.hit++;if(Number.isFinite(payout))s.returned100+=payout;}
  if(t.some(x=>x.split('-')[0]===trio[0]))s.first++;
  if(t.some(x=>x.split('-')[0]===trio[0]&&x.split('-')[1]===trio[1]))s.pair++;
 }
}
function finish(s){return Object.fromEntries(Object.entries(s).map(([k,x])=>[k,{...x,
 hitRate:x.n?+(x.hit/x.n*100).toFixed(1):null,pairRate:x.n?+(x.pair/x.n*100).toFixed(1):null,firstRate:x.n?+(x.first/x.n*100).toFixed(1):null,
 avgTickets:x.n?+(x.ticketCount/x.n).toFixed(2):0,roi:x.spent100?+(x.returned100/x.spent100*100).toFixed(1):null}]))}
function classR(row){const grade=String(row.input?.grade||'')+' '+String(row.input?.class||'');return /G[123]|Ｓ級|S級/.test(grade)?'S':'A_or_other';}
async function main(){
 const sources=await fetchVenues();
 const stats={new:results(),old:results(),legacy:results(),newOracle:results(),oldOracle:results()};
 const errors=[],examples=[],exclusions={},auditSources={},group={},one=()=>({n:0,bHits:0,oldBHits:0,new:results(),old:results(),newOracle:results(),oldOracle:results()});
 let matched=0,correctB=0,oldCorrectB=0,ofWhichBLeaderWon=0,bLeaderTop3=0,bLineWinner=0,bLinePair=0;
 const uniq=new Set();
 for(const row of rows){
  const identity=row.race_id;
  if(uniq.has(identity)){errors.push({id:identity,reason:'duplicate'});continue;}uniq.add(identity);
  const venue=row.venue||row.result?.race?.venue||String(identity).split(':')[1],raceNo=Number(row.result?.race?.race_no||identity.split(':')[2]);
  const file=path.resolve(ROOT,row.history_url||'');
  const source=sources.get(venue),observed=source?.parsed.get(raceNo);
  const exclude=(reason,detail)=>{exclusions[reason]=(exclusions[reason]||0)+1;errors.push({id:identity,reason,detail});};
  if(!source||source.error){exclude('provider_unavailable',source?.error);continue;}
  if(!observed||observed.status!=='ok'){exclude('b_or_finish_not_readable',observed||{available:[...source.parsed.keys()]});continue;}
  if(!file.startsWith(path.join(ROOT,'data/lab_history')+path.sep)){exclude('unsafe_history');continue;}
  if(!fs.existsSync(file)){exclude('history_missing',row.history_url);continue;}
  try{
   const stored=JSON.parse(fs.readFileSync(file,'utf8')),raw=stored.input;
   const cutoff=Date.parse(raw.date+'T'+raw.start+':00+09:00'),saved=Date.parse(stored.saved_at),publicTrio=row.result?.combos?.[0]?.key;
   if(stored.race_id!==identity||stored.pre_race!==true||!Number.isFinite(cutoff)||!(saved<cutoff)||stored.saved_at!==row.saved_at)throw Error('pre-race evidence failed');
   const actual=observed.finish.join('-');
   if(publicTrio!==actual)throw Error('result feed mismatch Chariloto:'+publicTrio+' versus '+actual);
   const historical=Input.prepare(raw,{},saved);
   if(!historical.race.riders.some(r=>r.no===observed.b))throw Error('B not in race');
   if(historical.race.riders.length!==observed.rowCount)throw Error('rider count changed or scratch: '+historical.race.riders.length+' vs '+observed.rowCount);
   // The 139-day archive is dated through Nov7, so it is NOT permissible in a Nov7 replay.
   // Ex counts have no observations; an empty EX store can be passed safely.
   historical.bAxisHistory=study;historical.bAxisEx=ex;
   const nn=B.build(historical,{limit:10}),oo=Old.build(historical,{limit:10});
   const on=B.build(historical,{bNo:observed.b,limit:10}),ob=Old.build(historical,{bNo:observed.b,limit:10});
   const pay=row.result?.combos?.[0]?.payout;
   const nKeys=nn.tickets.map(t=>t.key),oKeys=oo.tickets.map(t=>t.key),onKeys=on.tickets.map(t=>t.key),obKeys=ob.tickets.map(t=>t.key);
   score(stats.new,nKeys,actual,pay);score(stats.old,oKeys,actual,pay);score(stats.newOracle,onKeys,actual,pay);score(stats.oldOracle,obKeys,actual,pay);
   score(stats.legacy,(stored.chosen||[]).map(t=>t.key),actual,pay);
   const gKey=historical.race.riders.length+'車';
   group[gKey]??=one();const g=group[gKey];g.n++;
   for(const [mode,picks] of [['new',nKeys],['old',oKeys],['newOracle',onKeys],['oldOracle',obKeys]])score(g[mode],picks,actual,pay);
   if(nn.b.bNo===observed.b){correctB++;g.bHits++;}
   if(oo.b.bNo===observed.b){oldCorrectB++;g.oldBHits++;}
   matched++;
   const bLine=historical.race.lineup.find(l=>l.includes(observed.b));
   if(observed.finish[0]===observed.b)ofWhichBLeaderWon++;
   if(observed.finish.includes(observed.b))bLeaderTop3++;
   if(bLine.includes(observed.finish[0]))bLineWinner++;
   if(bLine.includes(observed.finish[0])&&bLine.includes(observed.finish[1]))bLinePair++;
   const expectedPair=actual.split('-').slice(0,2).join('-');
   examples.push({
    id:identity,venue,raceNo,field:historical.race.riders.length,category:gKey,lines:historical.race.lineup.map(l=>l.join('-')),
    actualB:observed.b,bLine:bLine.join('-'),actual,payout:pay,modelB:nn.b.bNo,oldB:oo.b.bNo,
    modelBHit:nn.b.bNo===observed.b,oracle5:onKeys.slice(0,5).includes(actual),normal5:nKeys.slice(0,5).includes(actual),
    oldOracle5:obKeys.slice(0,5).includes(actual),oldNormal5:oKeys.slice(0,5).includes(actual),
    newTop5:nKeys.slice(0,5),oldTop5:oKeys.slice(0,5),newOracleTop5:onKeys.slice(0,5),oldOracleTop5:obKeys.slice(0,5),
    pairNewOracle5:onKeys.slice(0,5).some(k=>k.startsWith(expectedPair+'-')),
    storedAt:stored.saved_at,source_url:source.url,
    diagnostic:actual.split('-').map(Number).map((no,i)=>({no,name:historical.race.riders.find(r=>r.no===no)?.name,place:i+1}))
   });
  }catch(e){exclude('model_or_snapshot_failure',String(e.message||e).slice(0,200));}
 }
 const r={
  schema:'tk-baxis-2026-11-07-replay/v1',date:DATE,generated_at:new Date().toISOString(),
  comparison:'B-AXIS v0.5 versus B-AXIS v0.2; both built after 2026-11-07',rows:rows.length,sourceVenues:[...sources].map(([name,s])=>({name,url:s.url,races:s.parsed.size,error:s.error||null})),
  matched,exclusions,errors,correctB,oldCorrectB,
  bLeaderWins:ofWhichBLeaderWon,bLeaderTop3,bLineWins:bLineWinner,bLineFirstTwo:bLinePair,
  stats:Object.fromEntries(Object.entries(stats).map(([k,x])=>[k,finish(x)])),
  groups:Object.fromEntries(Object.entries(group).map(([k,g])=>[k,{n:g.n,bHits:g.bHits,oldBHits:g.oldBHits,new:finish(g.new),old:finish(g.old),newOracle:finish(g.newOracle),oldOracle:finish(g.oldOracle)}])),
  examples,
  caveats:['Backtest replays the later-developed models on pre-race snapshots; not genuine historical live forecasts.',
   'Actual B is loaded only in Oracle branch and is not fed to the model in normal branch.',
   'Public Chariloto B markers and published trifecta independently joined; only rows with matching result and snapshot accepted.',
   'Rider history snapshot through Nov7 is date-gated, therefore not used for Nov7 predictions.',
   'ROI is hypothetical equal-stake if payouts are valid; model was developed after event and odds were not captured at that time.']
 };
 console.log('B_AXIS_NOV7_REPLAY '+JSON.stringify(r));
 if(process.env.B_AXIS_REPORT_PATH)fs.writeFileSync(process.env.B_AXIS_REPORT_PATH,JSON.stringify(r,null,2)+'\n');
 if(!matched)process.exitCode=1;
}
main().catch(e=>{console.error('B_AXIS_NOV7_ERROR '+e.stack);process.exitCode=1;});
