/* EX-equivalent 5 contextual domains from public FINISH data, not WINTICKET EX.
 * The verified official EX categories are available separately in ex-data.js.
 * This adapter must never use results on or after the target race date.
 */
(function(root){'use strict';
const AXES=['position','race_type','bank_length','weather','time_band'];
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
function allowed(archive,race){
 return archive?.schema==='tk-b-axis-ex-context-history/v1'&&
 archive.training_end&&race?.date&&archive.training_end<race.date&&
 archive.provenance?.actual_b_available===false&&archive.provenance?.winticket_ex_metrics===false;
}
function stats(archive,subject,axis,key){
 if(!AXES.includes(axis)||!key)return null;
 return archive?.[subject]?.[axis]?.[key]||null;
}
function snapshot(input,rider){
 const a=input?.bAxisExContext,race=input?.race;
 if(!allowed(a,race))return {valid:false,keys:keys(race,rider),basis:'履歴欠損または日付制限'};
 const id=idOf(rider),k=keys(race,rider),contributions=[],available=[];
 for(const axis of AXES){
  const key=k[axis];if(!key)continue;
  const global=stats(a,'population',axis,key);
  const personal=a?.riders?.[id]?.[axis]?.[key];
  if(!global||global.n<15||!personal||personal.n<3)continue;
  const baseline=(global.top3+3)/(global.n+6);
  const shrink=24;
  const personalRate=(personal.top3+baseline*shrink)/(personal.n+shrink);
  const weighted=(personalRate-baseline)*Math.min(1,personal.n/12);
  contributions.push({axis,key,n:personal.n,top3:personal.top3,globalN:global.n,globalTop3:global.top3,
    deviation:Math.round(weighted*10000)/10000});
  available.push(axis);
 }
 const influence=clamp(contributions.reduce((s,x)=>s+x.deviation,0),-.15,.15);
 return {valid:true,keys:k,support:Math.round(influence*10000)/10000,contributions,
  missing:AXES.filter(axis=>!available.includes(axis)),basis:'公式EX数値ではなく、公開出走表の条件×確定着順による自前実績（時点制限適用）'};
}
const api={AXES,idOf,roundType,timeBand,bankLength,weather,position,keys,allowed,snapshot};
if(typeof module!=='undefined')module.exports=api;
root.BAxisExContext=api;
})(typeof globalThis!=='undefined'?globalThis:this);
