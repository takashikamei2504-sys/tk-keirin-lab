/* Original EX observations from a source-licensed feed: optional causal feature support.
 * OFF unless rights to use AND redistribute figures are explicitly confirmed.
 * Conditional success rate changes conditional outcome ONLY, never tactic use frequency.
 */
(function(root){'use strict';
const clamp=(x,a=-1,b=1)=>Math.max(a,Math.min(b,x));
const APPROVAL='approved-for-model-and-publication';
const keys=['kamashi','tsuppari','chigiri','chigirarare','tobitsuki'];
function cutoffOf(race){
 const t=Date.parse(String(race?.date||'')+'T'+String(race?.start||'')+':00+09:00');
 return Number.isFinite(t)?t:null;
}
function normalizeID(id){return String(id||'').replace(/^0+(?=\d)/,'');}
function record(pack,rider,race,asOf=Date.now()){
 if(pack?.schema!=='tk-b-axis-ex-observations/v1'||pack?.license_status!==APPROVAL||
    pack?.redistribution_approved!==true||!pack?.riders)return null;
 if(pack.license_expires_at&&(!Number.isFinite(Date.parse(pack.license_expires_at))||Date.now()>Date.parse(pack.license_expires_at)))return null;
 const cutoff=cutoffOf(race),now=Number(asOf),bound=Math.min(cutoff||-Infinity,Number.isFinite(now)?now:Date.now());
 const row=pack.riders[normalizeID(rider?.meta?.rider_id)]||pack.riders[normalizeID(rider?.rider_id)];
 if(!row||typeof row!=='object'||!Number.isFinite(bound))return null;
 const collected=Date.parse(row.collected_at),published=Date.parse(row.published_at);
 if(!Number.isFinite(collected)||!Number.isFinite(published)||collected>=cutoff||
    collected>bound||published>collected||
    !/^https:\/\/www\.winticket\.jp\/keirin\/[^#\s]+$/i.test(row.source_url||''))return null;
 if(row.period_end&&row.period_end>=race.date)return null;
 return row;
}
function validatedCount(m){
 if(!m||!Number.isInteger(m.events)||!Number.isInteger(m.opportunities)||
    m.events<0||m.opportunities<1||m.events>m.opportunities)return null;
 const pct=m.events/m.opportunities;
 if(Number.isFinite(m.rate)&&Math.abs(m.rate-pct)>.0101)return null;
 return {events:m.events,n:m.opportunities,rate:pct,confidence:m.opportunities/(m.opportunities+20)};
}
function selectionKeys(race,rider){
 const line=(race?.lineup||[]).find(x=>x.includes(rider?.no))||[];
 const pos=line.indexOf(rider?.no);
 let position=null;
 if(pos>=0)position=line.length===1?'solo':pos===0?'leader':pos===1?'second':pos===2?'thirdPlus':null;
 const type=String(race?.class||'');
 const race_type=/決勝/.test(type)?'final':/準決/.test(type)?'semifinal':
  /特選|特別|シード|優秀/.test(type)?'seed':/予選|一次|二次/.test(type)?'qualifying':
  /一般|選抜|敗者|負け|特一般/.test(type)?'loser':null;
 const length=Number(race?.ex_context?.track_length);
 const bank_length=length>=330&&length<=335?'333':length>=398&&length<=402?'400':length>=498&&length<=502?'500':null;
 const weatherText=race?.ex_context?.weather_source_verified===true?String(race.ex_context.weather||''):'';
 const weather=/雨|rain/i.test(weatherText)?'rain':/曇|くも|cloud/i.test(weatherText)?'cloud':
  /晴|sun/i.test(weatherText)?'sun':/雪|snow/i.test(weatherText)?'snow':null;
 const time_band=race?.ex_context?.time_band_source_verified===true?race.ex_context.time_band:null;
 return {position,race_type,bank_length,weather,time_band};
}
function applyContexts(p,row,race,rider){
 const keys=selectionKeys(race,rider);
 const labels={position:'ライン位置',race_type:'レース種別',bank_length:'周長',weather:'天候',time_band:'時間帯'};
 let impact=0,covered=0;
 for(const [axis,key] of Object.entries(keys)){
  const m=key&&row.contextual?.[axis]?.[key];
  if(!m||!Number.isInteger(m.opportunities)||m.opportunities<1||!Number.isInteger(m.wins)||
     !Number.isInteger(m.top3)||m.top3<m.wins||m.top3>m.opportunities)continue;
  const n=m.opportunities,prior=.42;
  const shrunk=(m.top3+prior*24)/(n+24);
  const delta=clamp((shrunk-prior)*Math.min(1,n/15)*.11,-.03,.03);
  impact+=delta;covered++;
  p.measurements.push('公式EX条件別 '+labels[axis]+'('+key+') '+m.top3+'/'+n+'連対');
 }
 if(covered){
  p.finish=clamp(p.finish+clamp(impact,-.07,.07),.08,.92);
  p.ex_context_used=covered;
 }
}

function attach(profile,rider,race,pack,asOf){
 const p=profile;
 const row=record(pack,rider,race,asOf);
 if(!row)return p;
 const labels={kamashi:'カマシ',tsuppari:'突っ張り',chigiri:'ちぎり',chigirarare:'ちぎられ',tobitsuki:'飛びつき'};
 let count=0;
 for(const metric of keys){
  const m=validatedCount(row.metrics?.[metric]);
  if(!m)continue;
  // Excessively rare actions carry almost no weight; success is conditional on trying.
  const prior=metric==='chigiri'||metric==='chigirarare'?.22:.5;
  const shrink=(m.events+prior*20)/(m.n+20),delta=(shrink-prior)*m.confidence*.22;
  p['ex_'+metric+'_delta']=clamp(delta,-.085,.085);
  p.measurements.push('WINTICKET EX '+labels[metric]+' '+m.events+'/'+m.n+'（'+(m.rate*100).toFixed(1)+'%）');
  count++;
 }
 if(count){
  p.ex_source_url=row.source_url;
  p.ex_collected_at=row.collected_at;
  p.ex_used=count;
  p.basis+='＋EX実測';
 }
 applyContexts(p,row,race,rider);
 if(p.ex_context_used&&!p.ex_used){p.ex_source_url=row.source_url;p.basis+='＋EX条件別実測';}
 return p;
}
const api={attach,record,validatedCount,selectionKeys,applyContexts,cutoffOf,APPROVAL};
if(typeof module!=='undefined')module.exports=api;
root.LabExProfile=api;
})(typeof globalThis!=='undefined'?globalThis:this);
