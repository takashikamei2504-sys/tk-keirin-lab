/* EX-equivalent 5 contextual domains from public FINISH data, not WINTICKET EX.
 * The verified official EX categories are available separately in ex-data.js.
 * This adapter must never use results on or after the target race date.
 */
(function(root){'use strict';
const AXES=['position','race_type','bank_length','weather','time_band'];
const Ex=typeof module!=='undefined'?require('./ex-data.js'):root.BAxisEx;
const clamp=(v,a=-1,b=1)=>Math.max(a,Math.min(b,v));
function idOf(r){return String(r?.meta?.rider_id||r?.rider_id||'').replace(/^0+(?=\d)/,'');}
function timeBand(t){
 const m=/^(\d{1,2}):(\d{2})$/.exec(String(t||''));
 if(!m)return null;
 const hour=Number(m[1]),min=Number(m[2]);if(hour>23||min>59)return null;
 return hour<12?'morning':hour<17?'day':hour<21?'night':'midnight';
}
function roundType(v){
 const name=String(v||'');
 if(/準決/.test(name))return 'semifinal';
 if(/決勝/.test(name))return 'final';
 if(/特選|特別|シード|優秀/.test(name))return 'seed';
 if(/予選|一次|二次/.test(name))return 'qualifying';
 if(/一般|選抜|敗者|負け|特一般/.test(name))return 'loser';
 return null;
}
function bankLength(m){
 const n=Number(m);
 if(!Number.isFinite(n))return null;
 return n>=330&&n<=335?'333':n>=398&&n<=402?'400':n>=498&&n<=502?'500':null;
}
function weather(v){
 const t=String(v||'');
 if(/雪|snow/i.test(t))return 'snow';
 if(/雨|rain/i.test(t))return 'rain';
 if(/曇|くも|cloud/i.test(t))return 'cloud';
 if(/晴|sun/i.test(t))return 'sun';
 return null;
}
function position(race,rider){
 const line=(race?.lineup||[]).find(a=>a.includes(rider?.no));
 if(!line)return null;
 if(line.length===1)return 'solo';
 const i=line.indexOf(rider.no);
 return i===0?'leader':i===1?'second':'thirdPlus';
}
function keys(race,rider){
 const ex=race?.ex_context||{};
 const w=ex.weather_source_verified===true?weather(ex.weather):null;
 return {position:position(race,rider),race_type:roundType(race?.class||race?.round_name),
 bank_length:bankLength(ex.track_length),weather:w,time_band:timeBand(race?.start||race?.start_time)};
}
function asOfJapanDate(input){
 const ts=Date.parse(input?.as_of);
 return Number.isFinite(ts)?new Date(ts+9*3600000).toISOString().slice(0,10):null;
}
function allowed(archive,race,input){
 return archive?.schema==='tk-b-axis-ex-context-history/v1'&&
 archive.training_end&&race?.date&&archive.training_end<race.date&&
 asOfJapanDate(input)>archive.training_end&&
 archive.provenance?.actual_b_available===false&&archive.provenance?.winticket_ex_metrics===false;
}
function stats(archive,subject,axis,key){
 if(!AXES.includes(axis)||!key)return null;
 return archive?.[subject]?.[axis]?.[key]||null;
}
function snapshot(input,rider){
 const archive=input?.bAxisExContext,race=input?.race;
 const liveArchive=allowed(archive,race,input),id=idOf(rider),k=keys(race,rider);
 const contributions=[],official=[],historical=[];
 for(const axis of AXES){
  const key=k[axis];if(!key)continue;
  const slot=(race?.lineup||[]).find(l=>l.includes(rider.no))?.indexOf(rider.no);
  const sourceTimeVerified=race?.ex_context?.time_band_source_verified===true&&race.ex_context.time_band===key;
  const published=(axis==='position'&&slot>2)||(axis==='time_band'&&!sourceTimeVerified)?null:
    Ex.contextual(input,rider,axis,key,{asOf:input.as_of});
  const global=liveArchive?stats(archive,'population',axis,key):null;
  const raw=liveArchive?archive?.riders?.[id]?.[axis]?.[key]:null;
  let n,top3,baseline,origin;
  if(published){
   n=published.opportunities;top3=published.top3;
   baseline=global?.n>=15?(global.top3+3)/(global.n+6):.38;
   origin='WINTICKET_EX';official.push(axis);
  }else if(global?.n>=15&&raw?.n>=3){
   n=raw.n;top3=raw.top3;
   baseline=(global.top3+3)/(global.n+6);
   origin='PUBLIC_RESULT_DERIVED';historical.push(axis);
  }else continue;
  const shrink=24,rate=(top3+baseline*shrink)/(n+shrink),weighted=(rate-baseline)*Math.min(1,n/12);
  contributions.push({axis,key,n,top3,origin,deviation:Math.round(weighted*10000)/10000});
 }
 const support=clamp(contributions.reduce((s,x)=>s+x.deviation,0),-.15,.15);
 return {valid:contributions.length>0,keys:k,support:Math.round(support*10000)/10000,
  contributions,official,historical,missing:AXES.filter(axis=>!contributions.some(x=>x.axis===axis)),
  basis:'原典付きEXの条件別成績を優先。未取得時は時点制限済み公開結果による自前の条件別3連対を参照'};
}
const api={AXES,idOf,roundType,timeBand,bankLength,weather,position,keys,asOfJapanDate,allowed,snapshot};
if(typeof module!=='undefined')module.exports=api;
root.BAxisExContext=api;
})(typeof globalThis!=='undefined'?globalThis:this);
