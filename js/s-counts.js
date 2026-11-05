/* Apply race-specific pre-start S counts with full rider/number verification. */
(function(root){'use strict';
const schema='tk-keirin-s-counts/v1';
const norm=x=>String(x||'').normalize('NFKC').replace(/[\s\u3000]/g,'');
function attach(r,pack={},now=Date.now()){
 if(pack?.schema!==schema||!Array.isArray(pack.snapshots))return r;
 const cutoff=Date.parse(r.date+'T'+r.start+':00+09:00');
 const at=typeof now==='number'?now:Date.parse(now);
 if(!Number.isFinite(cutoff)||!Number.isFinite(at))return r;
 const rows=pack.snapshots.filter(v=>v.date===r.date&&v.venue===r.venue&&Number(v.race_no)===r.race_no&&
  v.complete===true&&v.source_url?.startsWith('https://keirin.netkeiba.com/race/entry/')&&
  Number.isFinite(Date.parse(v.collected_at))&&Date.parse(v.collected_at)<cutoff&&Date.parse(v.collected_at)<=at&&
  Array.isArray(v.riders)&&v.riders.length===r.riders.length);
 rows.sort((a,b)=>Date.parse(b.collected_at)-Date.parse(a.collected_at));
 const snap=rows.find(v=>r.riders.every(x=>v.riders.some(y=>y.no===x.no&&norm(y.name)===norm(x.name)&&Number.isInteger(y.s)&&y.s>=0&&y.s<=100))&&
  new Set(v.riders.map(y=>y.no)).size===r.riders.length);
 if(!snap)return r;
 return {...r,riders:r.riders.map(x=>{
  if(Number.isInteger(x.s)&&!x.meta?.absent_fields?.includes('s'))return x;
  const s=snap.riders.find(y=>y.no===x.no).s;
  return {...x,s,s_source:{url:snap.source_url,collected_at:snap.collected_at,race_id:snap.race_id},meta:{...x.meta,
   absent_fields:(x.meta?.absent_fields||[]).filter(k=>k!=='s'),
   supplied_fields:[...new Set([...(x.meta?.supplied_fields||[]),'s'])]}};
 })};
}
const api={schema,attach};if(typeof module!=='undefined')module.exports=api;root.SCounts=api;
})(typeof globalThis!=='undefined'?globalThis:this);
