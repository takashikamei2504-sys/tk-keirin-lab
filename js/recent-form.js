/* Strict, immutable application of measured pre-race recent-form snapshots. */
(function(root){'use strict';
const schema='tk-keirin-recent-form/v1',norm=s=>String(s||'').replace(/[\s\u3000]/g,''),numeric=['wins','seconds','thirds','unplaced','withdrawals','disqualifications','total','b'];
function valid(s){const v=s?.stats;return s?.verified_identity===true&&/^\d{6}$/.test(s.rider_id||'')&&/^https:\/\/www\.keirin\.jp\/pc\/racerprofile\?snum=\d{6}$/.test(s.source_url||'')&&v&&numeric.every(k=>Number.isInteger(v[k])&&v[k]>=0)&&['win_rate','top2_rate','top3_rate'].every(k=>Number.isFinite(v[k])&&v[k]>=0&&v[k]<=100)&&v.total>=v.wins+v.seconds+v.thirds&&v.win_rate<=v.top2_rate&&v.top2_rate<=v.top3_rate;}
function attach(r,pack={},now=Date.now()){
 const cutoff=Date.parse(`${r.date}T${r.start}:00+09:00`);
 const rows=pack.schema===schema&&Array.isArray(pack.snapshots)?pack.snapshots:[];
 const riders=r.riders.map(x=>{
  const rid=x.meta?.rider_id?String(x.meta.rider_id).padStart(6,'0'):null;
  const matches=rows.filter(s=>norm(s.name)===norm(x.name)&&(!rid||s.rider_id===rid)&&valid(s));
  const eligible=matches.filter(s=>{const c=Date.parse(s.collected_at),u=Date.parse(s.source_updated_at);return Number.isFinite(c)&&Number.isFinite(u)&&u<=c&&c<cutoff&&c<=now&&u<cutoff&&cutoff-u<=72*3600000;}).sort((a,b)=>Date.parse(b.source_updated_at)-Date.parse(a.source_updated_at)||Date.parse(b.collected_at)-Date.parse(a.collected_at));
  const recent=eligible[0];
  if(!recent)return {...x,recent_form:null,form_status:matches.length?'この発走前に利用可能な72時間以内の集計なし':'自動収集待ち・取得情報なし'};
  const st=recent.stats;
  return {...x,wins:st.wins,seconds:st.seconds,thirds:st.thirds,outs:st.total-st.wins-st.seconds-st.thirds,b:st.b,recent_form:recent,form_status:'取得済み',meta:{...x.meta,absent_fields:(x.meta?.absent_fields||[]).filter(k=>!['wins','seconds','thirds','outs','b'].includes(k)),supplied_fields:[...new Set([...(x.meta?.supplied_fields||[]),'wins','seconds','thirds','outs','b'])]}};
 });
 const count=riders.filter(x=>x.recent_form).length;
 return {...r,riders,recent_form_status:{covered:count,total:riders.length,generated_at:pack.generated_at||null},source:{...r.source,missing_fields:count===riders.length?(r.source?.missing_fields||[]).filter(k=>k!=='b_s_recent').concat(['s']):r.source?.missing_fields||[]}};
}

// Old files remain readable during rollout; a partial/mixed generation is never used.
const manifestSchema='tk-keirin-recent-form-shards/v2',partSchema='tk-keirin-recent-form-part/v1',partCount=32;
function refs(m){if(m?.schema!==manifestSchema||!Array.isArray(m.parts)||m.parts.length!==partCount)throw Error('Invalid recent-form manifest');return m.parts.map((r,i)=>{if(r.path!==`recent_form_parts/part-${String(i).padStart(2,'0')}.json`||!Number.isSafeInteger(r.count)||r.count<0)throw Error('Invalid recent-form shard reference');return r;});}
function merge(m,parts){let rows=[];refs(m).forEach((r,i)=>{const p=parts[i];if(p?.schema!==partSchema||p.generated_at!==m.generated_at||!Array.isArray(p.snapshots)||p.snapshots.length!==r.count||p.snapshots.some(s=>!/^\d{6}$/.test(s.rider_id)||Number(s.rider_id)%partCount!==i))throw Error('Recent-form shard mismatch');rows.push(...p.snapshots)});if(rows.length!==m.snapshot_count)throw Error('Recent-form count mismatch');const {parts:_,snapshot_count:__,...meta}=m;return {...meta,schema,snapshots:rows};}
async function load(url,read){const m=await read(url);if(m?.schema===schema&&Array.isArray(m.snapshots))return m;const r=refs(m),parts=[];const [path,query]=url.split('?');const dir=path.slice(0,path.lastIndexOf('/')+1);for(let i=0;i<r.length;i+=4)parts.push(...await Promise.all(r.slice(i,i+4).map(x=>read(dir+x.path+(query?'?'+query:'')))));return merge(m,parts);}
function readFile(file){const fs=require('node:fs'),path=require('node:path');if(!fs.existsSync(file))return {};const m=JSON.parse(fs.readFileSync(file,'utf8'));if(m?.schema===schema&&Array.isArray(m.snapshots))return m;return merge(m,refs(m).map(r=>JSON.parse(fs.readFileSync(path.join(path.dirname(file),r.path),'utf8'))));}
const api={schema,valid,attach,load,readFile};if(typeof module!=='undefined')module.exports=api;root.RecentForm=api;
})(typeof globalThis!=='undefined'?globalThis:this);
