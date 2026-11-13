/* Present upcoming cross-line purchase candidates separately from concluded or unverified races.
 * NO prediction mutation, no result inputs, no post-start prediction treated as live. */
(function(root){'use strict';
const VERSION='crossline-selected-v1-20261114';
const supported=s=>!!s&&!s.is_girls&&Array.isArray(s.entries)&&s.entries.length===7&&s.entries.every(e=>/^A[123]$/.test(String(e.class_rank||'')));
const raceId=(date,s)=>[date,s.venue,Number(s.race_number)].join(':');
const cutoff=(date,start)=>Date.parse(date+'T'+start+':00+09:00');
const identity=r=>r.riders.map(x=>[Number(x.no),String(x.meta?.rider_id||''),String(x.name||'').replace(/[\s\u3000]/g,'')]).sort((a,b)=>a[0]-b[0]);
function validForecast(f){
 if(!f||f.version!==VERSION||!['A7','C7'].includes(f.category)||
 !Array.isArray(f.pairs)||f.pairs.length!==2||!Array.isArray(f.candidate4)||f.candidate4.length!==4||
 new Set(f.candidate4).size!==4||!Array.isArray(f.tickets))return false;
 const keys=f.candidate4.every(k=>typeof k==='string'&&/^[1-9]-[1-9]-[1-9]$/.test(k)&&new Set(k.split('-')).size===3);
 const reverse=f.pairs[0][0]===f.pairs[1][1]&&f.pairs[0][1]===f.pairs[1][0];
 return keys&&(f.eligible===true?!!f.risk?.priority&&!reverse&&f.tickets.length===4&&f.tickets.every((t,i)=>t===f.candidate4[i])&&f.stake===400:
 f.eligible===false&&f.tickets.length===0&&f.stake===0);
}
function validSaved(h,date){
 if(!h||h.date!==date||h.race_id!==[h.date,h.venue,h.race_no].join(':')||!validForecast(h.forecast))return false;
 const start=cutoff(date,h.start),saved=Date.parse(h.saved_at),source=Date.parse(h.source_generated_at);
 return Number.isFinite(start)&&Number.isFinite(saved)&&Number.isFinite(source)&&saved<start&&source<=saved&&source<start;
}
function assemble({date,feed=null,rows=[],now=Date.now(),weights=null,riskLib=null,riskModel=null,convert=null,predict=null}={}){
 const upcoming=[],concluded=[],skipped=[],invalid=[];
 const byId=new Map((Array.isArray(rows)?rows:[]).filter(x=>x.date===date).map(x=>[x.race_id,x]));
 const sourceOK=feed?.date===date&&Array.isArray(feed.races)&&Number.isFinite(Date.parse(feed.generated_at))&&Date.parse(feed.generated_at)<=now;
 const raw=sourceOK?feed.races.filter(supported):[];
 const processed=new Set();
 const append=(item)=>{
  if(!item.forecast.eligible){skipped.push(item);return;}
  if(item.startAt>now)upcoming.push(item);
  else concluded.push(item);
 };
 for(const s of raw){
  const id=raceId(date,s);processed.add(id);
  const startAt=cutoff(date,s.start_time),h=byId.get(id);
  if(!Number.isFinite(startAt)){invalid.push({race_id:id,reason:'発走時刻の取得不可'});continue;}
  let forecast=null,source=null,converted=null,reason=null;
  if(validSaved(h,date)){
   if(h.identity){try{
    if(typeof convert!=='function')throw Error('照合できません');
    converted=convert(s,feed);
    if(JSON.stringify(identity(converted))!==JSON.stringify(h.identity)){
     invalid.push({race_id:id,reason:'保存時と選手が異なります'});continue;
    }
   }catch(e){invalid.push({race_id:id,reason:'保存時の出走者照合不可'});continue;}}
   forecast=h.forecast;source='frozen';
  }else if(startAt>now&&Date.parse(feed.generated_at)<startAt){
   try{
    if(!weights||!riskLib||!riskModel||typeof convert!=='function'||typeof predict!=='function')throw Error('モデル取得待ち');
    converted=converted||convert(s,feed);
    forecast=predict(converted,weights,riskLib,riskModel);
    if(!validForecast(forecast))throw Error('予測形式の検証に失敗');
    source='live';
   }catch(e){reason=String(e.message||e); }
  }else reason=startAt<=now?'発走前予想が保存されていません':'出走表の配信時刻を確認できません';
  if(!forecast){invalid.push({race_id:id,reason});continue;}
  append({race_id:id,date,venue:s.venue,race_no:Number(s.race_number),start:s.start_time,startAt,
    forecast,source,saved_at:h?.saved_at||null,source_generated_at:source==='frozen'?h.source_generated_at:feed.generated_at});
 }
 for(const h of byId.values()){
  if(processed.has(h.race_id))continue;
  if(!validSaved(h,date)){invalid.push({race_id:h.race_id,reason:'保存内容を検証できません'});continue;}
  append({race_id:h.race_id,date,venue:h.venue,race_no:Number(h.race_no),start:h.start,
   startAt:cutoff(date,h.start),forecast:h.forecast,source:'frozen',
   saved_at:h.saved_at,source_generated_at:h.source_generated_at});
 }
 const sort=(a,b)=>a.startAt-b.startAt||a.venue.localeCompare(b.venue,'ja')||a.race_no-b.race_no;
 for(const list of [upcoming,concluded,skipped])list.sort(sort);
 return {date,feed_ok:sourceOK,source_updated_at:sourceOK?feed.generated_at:null,
  upcoming,concluded,skipped,invalid,checked:upcoming.length+concluded.length+skipped.length,
  stake:upcoming.length*400,points:upcoming.length*4};
}
const api={VERSION,supported,validForecast,validSaved,assemble};
if(typeof module!=='undefined')module.exports=api;
root.CrosslineCandidateList=api;
})(typeof globalThis!=='undefined'?globalThis:this);
