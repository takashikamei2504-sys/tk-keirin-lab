'use strict';
// Offline-only schema inventory for lawfully supplied source snapshots.
// Reports FIELD PATHS / TYPES ONLY, not any EX values or personal details.
const fs=require('node:fs');
const {extractPreloadedState}=require('./winticket_ex_extract.cjs');
const names=/ex|context|condition|position|bank|length|weather|timeBand|timeSlot|raceType|lineRole|location/i;
function inspect(state){
 const queries=state?.tanStackQuery?.queries||[];
 if(!Array.isArray(queries))throw Error('TANSTACK_QUERIES_INVALID');
 const seen=new Map();
 function walk(node,path,depth){
  if(depth>7||!node||typeof node!=='object')return;
  if(Array.isArray(node)){if(node.length)walk(node[0],path+'[]',depth+1);return;}
  for(const [k,v] of Object.entries(node)){
   const key=path+'.'+k;
   if(names.test(k)){
    const type=Array.isArray(v)?'array':v===null?'null':typeof v;
    seen.set(key,type+(Array.isArray(v)?' len:'+v.length:''));
   }
   if(v&&typeof v==='object')walk(v,key,depth+1);
  }
 }
 for(const q of queries){
  const key=(q.queryKey||[]).map(x=>typeof x==='string'?x:'<nonstring>').join('/');
  if(!/KEIRIN|EX/i.test(key))continue;
  walk(q.state?.data||{},key,0);
 }
 return {schema:'tk-ex-context-field-path-inventory/v1',query_count:queries.length,
    candidate_paths:[...seen].sort(([a],[b])=>a.localeCompare(b)).map(([path,type])=>({path,type})),
    warning:'Names and value types alone do not establish EX semantic mappings. No raw values are exported.'};
}
function main(){
 const argv=process.argv.slice(2);
 if(argv.length!==1)throw Error('Usage: node scripts/ex_context_shape_audit.cjs AUTHORIZED_RACECARD.html-or-state.json');
 const raw=fs.readFileSync(argv[0],'utf8');
 const state=raw.trimStart().startsWith('{')?JSON.parse(raw):extractPreloadedState(raw);
 console.log(JSON.stringify(inspect(state),null,2));
}
if(require.main===module){try{main();}catch(e){console.error('EX_SHAPE_ERROR '+e.message);process.exitCode=1;}}
module.exports={inspect};
