/* Sharded recent-form storage reader. Keep prediction logic and model identity unchanged. */
(function(root){'use strict';
const schema='tk-keirin-recent-form/v1';
// Old files remain readable during rollout; a partial/mixed generation is never used.
const manifestSchema='tk-keirin-recent-form-shards/v2',partSchema='tk-keirin-recent-form-part/v1',partCount=32;
function refs(m){if(m?.schema!==manifestSchema||!Array.isArray(m.parts)||m.parts.length!==partCount)throw Error('Invalid recent-form manifest');return m.parts.map((r,i)=>{if(r.path!==`recent_form_parts/part-${String(i).padStart(2,'0')}.json`||!Number.isSafeInteger(r.count)||r.count<0)throw Error('Invalid recent-form shard reference');return r;});}
function merge(m,parts){let rows=[];refs(m).forEach((r,i)=>{const p=parts[i];if(p?.schema!==partSchema||p.generated_at!==m.generated_at||!Array.isArray(p.snapshots)||p.snapshots.length!==r.count||p.snapshots.some(s=>!/^\d{6}$/.test(s.rider_id)||Number(s.rider_id)%partCount!==i))throw Error('Recent-form shard mismatch');rows.push(...p.snapshots)});if(rows.length!==m.snapshot_count)throw Error('Recent-form count mismatch');const {parts:_,snapshot_count:__,...meta}=m;return {...meta,schema,snapshots:rows};}
async function load(url,read){const m=await read(url);if(m?.schema===schema&&Array.isArray(m.snapshots))return m;const r=refs(m),parts=[];const [path,query]=url.split('?');const dir=path.slice(0,path.lastIndexOf('/')+1);for(let i=0;i<r.length;i+=4)parts.push(...await Promise.all(r.slice(i,i+4).map(x=>read(dir+x.path+(query?'?'+query:'')))));return merge(m,parts);}
function readFile(file){const fs=require('node:fs'),path=require('node:path');if(!fs.existsSync(file))return {};const m=JSON.parse(fs.readFileSync(file,'utf8'));if(m?.schema===schema&&Array.isArray(m.snapshots))return m;return merge(m,refs(m).map(r=>JSON.parse(fs.readFileSync(path.join(path.dirname(file),r.path),'utf8'))));}
const api={load,readFile};if(typeof module!=='undefined')module.exports=api;root.RecentFormStore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
