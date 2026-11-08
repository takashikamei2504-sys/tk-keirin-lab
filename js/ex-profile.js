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
 return p;
}
const api={attach,record,validatedCount,cutoffOf,APPROVAL};
if(typeof module!=='undefined')module.exports=api;
root.LabExProfile=api;
})(typeof globalThis!=='undefined'?globalThis:this);
