'use strict';
/* Read the same public feed and shared data; write only the new LINE namespace. */
const fs=require('node:fs'),path=require('node:path'),Engine=require('../js/line/engine.js'),Feed=require('../js/race-feed.js'),Store=require('./line-store.cjs');
const root=path.join(__dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
async function collect(){
 const packs={intelligence:read('data/intelligence.json'),recent:read('data/recent_form.json'),material:read('data/race_material.json')};let saved=0;const errors=[];
 for(const offset of [0,1]){
  const date=new Date(Date.now()+9*3600000+offset*86400000).toISOString().slice(0,10);
  try{const response=await fetch('https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/'+date+'.json',{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('HTTP '+response.status);const day=await response.json();if(day.date!==date||!Array.isArray(day.races))throw Error('Invalid feed');
   for(const source of day.races){
    if(source.is_girls||![7,9].includes(source.entries?.length))continue;
    const cutoff=Date.parse(`${date}T${source.start_time}:00+09:00`);if(!(Date.now()<cutoff))continue;
    try{const out=Engine.build(Feed.convert(source,day),packs),result=Store.freeze(out,path.join(root,'data/line_history'));if(result.saved)saved++;}catch(e){errors.push({date,venue:source.venue,r:source.race_number,error:e.message});}
   }
  }catch(e){errors.push({date,error:e.message});}
 }
 fs.mkdirSync(path.join(root,'data/line_history'),{recursive:true});
 fs.writeFileSync(path.join(root,'data/line_history/status.json'),JSON.stringify({generated_at:new Date().toISOString(),model_id:require('../js/line/build.js').model_id,saved,errors})+'\n');
 console.log(JSON.stringify({saved,errors}));
}
if(require.main===module)collect().catch(e=>{console.error(e);process.exit(1);});module.exports={collect};
