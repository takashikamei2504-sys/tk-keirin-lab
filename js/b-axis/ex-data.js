/* Opt-in public EX rider statistics: numeric values are used ONLY when
 * a source-linked, before-start observation with denominator is supplied.
 * No WINTICKET proprietary value is guessed from the public EX feature guide.
 */
(function(root){'use strict';
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const METRICS=['chigiri','chigirarare','kamashi','tsuppari','tobitsuki','seri','solo_win','solo_top3'];
const allowed=/^https:\/\/(?:www\.)?winticket\.jp\/keirin\/[^#\s]+$/i;
function identity(r){return String(r?.meta?.rider_id??r?.rider_id??'').replace(/^0+(?=\d)/,'');}
function record(input,r,asOf){
 const set=input?.bAxisEx;
 if(set?.schema!=='tk-b-axis-ex-observations/v1'||!set.riders)return null;
 const v=set.riders[identity(r)]||set.riders[String(r?.meta?.rider_id||'')];
 if(!v||typeof v!=='object'||!allowed.test(v.source_url||''))return null;
 const date=Date.parse(v.collected_at),published=Date.parse(v.published_at||v.collected_at);
 const cutoff=Date.parse(asOf||input?.as_of);
 if(!Number.isFinite(date)||!Number.isFinite(published)||!Number.isFinite(cutoff)||date>cutoff||published>date)return null;
 if(input?.race?.date&&v.period_end&&v.period_end>=input.race.date)return null;
 return v;
}
function evidence(input,r,key,opts={}){
 if(!METRICS.includes(key))return null;
 const row=record(input,r,opts.asOf);
 const m=row?.metrics?.[key];
 if(!m||typeof m!=='object')return null;
 const n=m.opportunities;
 const x=m.events;
 if(!Number.isInteger(n)||n<1||!Number.isInteger(x)||x<0||x>n)return null;
 const probability=x/n;
 if(Number.isFinite(m.rate)&&Math.abs(m.rate-probability)>.0101)return null;
 return {metric:key,events:x,opportunities:n,rate:Math.round(probability*10000)/10000,
   source_url:row.source_url,as_of:row.collected_at,period_end:row.period_end||null,
   coverage:'individually observed, source-linked',meaning:key==='chigirarare'?'line follower separation frequency':key==='chigiri'?'leader splitting followers frequency':'observed EX category frequency'};
}
function smoothed(input,r,key,prior=.5,priorN=20,asOf){
 const e=evidence(input,r,key,{asOf});
 if(!e)return null;
 return {...e,smoothed:(e.events+prior*priorN)/(e.opportunities+priorN),weight:e.opportunities/(e.opportunities+priorN)};
}
function tactics(input,r,asOf){
 const press=smoothed(input,r,'tsuppari',.5,18,asOf);
 const kamashi=smoothed(input,r,'kamashi',.5,18,asOf);
 return {press,kamashi};
}
function followerRisk(input,leader,follower,asOf){
 const separation=smoothed(input,leader,'chigiri',.22,20,asOf);
 const lost=smoothed(input,follower,'chigirarare',.22,20,asOf);
 if(!separation&&!lost)return null;
 const weight=((separation?.weight||0)+(lost?.weight||0))/2;
 const rate=(separation?.smoothed??.22)*.45+(lost?.smoothed??.22)*.55;
 return {risk:clamp(rate),weight,leader:separation,follower:lost,source:'EX labelled rates, not direct pairwise history'};
}
const api={identity,record,evidence,smoothed,tactics,followerRisk,METRICS};
if(typeof module!=='undefined')module.exports=api;
root.BAxisEx=api;
})(typeof globalThis!=='undefined'?globalThis:this);
