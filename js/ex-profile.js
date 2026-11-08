/* Original EX observations from a source-licensed feed: optional causal feature support.
 * OFF unless rights to use AND redistribute figures are explicitly confirmed.
 * Conditional success rate changes conditional outcome ONLY, never tactic use frequency.
 */
(function(root){'use strict';
const clamp=(x,a=-1,b=1)=>Math.max(a,Math.min(b,x));
const APPROVAL='approved-for-model-and-publication';
const keys=['kamashi','tsuppari','chigiri','chigirarare','tobitsuki','seri'];
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
function validContextBucket(m){
 if(!m||!Number.isInteger(m.opportunities)||m.opportunities<1||
    !Number.isInteger(m.wins)||m.wins<0||m.wins>m.opportunities||
    !Number.isInteger(m.top3)||m.top3<m.wins||m.top3>m.opportunities)return null;
 return {n:m.opportunities,wins:m.wins,top3:m.top3};
}
function contextResidual(row,axis,key){
 // Conditional EX domains refer to overlapping races. Compare each rider to
 // their OWN other buckets of the same axis, not an arbitrary 42% global prior.
 const all=row.contextual?.[axis]||{},active=validContextBucket(all[key]);
 if(!active||active.n<5)return null;
 const others=Object.entries(all).filter(([k])=>k!==key).map(([,v])=>validContextBucket(v)).filter(Boolean);
 const n=others.reduce((sum,v)=>sum+v.n,0);
 if(n<12)return null;
 const otherTop3=others.reduce((sum,v)=>sum+v.top3,0);
 const otherWins=others.reduce((sum,v)=>sum+v.wins,0);
 const p0=(otherTop3+10*.42)/(n+10),w0=(otherWins+10*.14)/(n+10);
 const shrunk=(active.top3+p0*25)/(active.n+25);
 const winShrunk=(active.wins+w0*30)/(active.n+30);
 // Confidence is bounded by independent observed attempts within that domain.
 // Never multiply apparent sample size by the five overlapping categories.
 const confidence=Math.min(1,active.n/25)*Math.min(1,n/35);
 return {axis,key,n:active.n,top3:active.top3,wins:active.wins,
  difference:(shrunk-p0)*confidence,winDifference:(winShrunk-w0)*confidence,
  confidence};
}
function applyContexts(p,row,race,rider){
 const chosen=selectionKeys(race,rider);
 const labels={position:'ライン位置',race_type:'レース種別',bank_length:'周長',weather:'天候',time_band:'時間帯'};
 const adjusted=[];
 let covered=0;
 for(const [axis,key] of Object.entries(chosen)){
  if(!key)continue;
  const m=validContextBucket(row.contextual?.[axis]?.[key]);
  if(!m)continue;
  covered++;
  p.measurements.push('公式EX条件別 '+labels[axis]+'('+key+') '+m.top3+'/'+m.n+'３着以内');
  const relative=contextResidual(row,axis,key);
  if(relative)adjusted.push(relative);
 }
 if(covered)p.ex_context_used=covered;
 // Use a confidence-weighted mean, NOT a sum of five heavily correlated axes.
 if(adjusted.length){
  const weight=adjusted.reduce((sum,x)=>sum+x.confidence,0);
  const top3=adjusted.reduce((sum,x)=>sum+x.difference*x.confidence,0)/weight;
  const wins=adjusted.reduce((sum,x)=>sum+x.winDifference*x.confidence,0)/weight;
  p.ex_context_residual=clamp(top3*.19,-.035,.035);
  p.ex_win_residual=clamp(wins*.12,-.025,.025);
  p.finish=clamp(p.finish+p.ex_context_residual,.08,.92);
  p.ex_context_comparisons=adjusted.map(x=>x.axis);
 }
}
function attach(profile,rider,race,pack,asOf){
 const p=profile;
 const row=record(pack,rider,race,asOf);
 if(!row)return p;
 const labels={kamashi:'カマシ',tsuppari:'突っ張り',chigiri:'ちぎり',chigirarare:'ちぎられ',tobitsuki:'飛びつき',seri:'競り'};
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
 // The EX lost-contact rate also informs baseline wheel tracking, but NOT
 // the rider's propensity to choose a tactic.
 if(Number.isFinite(p.ex_chigirarare_delta))p.track=clamp(p.track-.7*p.ex_chigirarare_delta,.12,.95);
 applyContexts(p,row,race,rider);
 if(p.ex_context_used&&!p.ex_used){p.ex_source_url=row.source_url;p.ex_collected_at=row.collected_at;p.basis+='＋EX条件別実測';}
 return p;
}
const api={attach,record,validatedCount,validContextBucket,contextResidual,selectionKeys,applyContexts,cutoffOf,APPROVAL};
if(typeof module!=='undefined')module.exports=api;
root.LabExProfile=api;
})(typeof globalThis!=='undefined'?globalThis:this);
