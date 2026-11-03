'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),P=require('../js/model-provenance.js');
function freeze(out,dir,now=Date.now()){
 const cutoff=Date.parse(out.input.cutoff),inputTime=Date.parse(out.input.as_of),generated=Date.parse(out.generated_at);
 if(out.mode!=='pre-race'||!(inputTime<=generated&&generated<=now&&now<cutoff))return {saved:false,reason:'not-pre-race'};
 const r=out.input.race,id=`${r.date}:${r.venue}:${r.race_no}|${out.provenance.model.model_id}`;
 const file=path.join(dir,r.date,crypto.createHash('sha256').update(id).digest('hex')+'.json');
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const record={schema:'tk-keirin-line-frozen/v1',race_id:id.split('|')[0],saved_at:new Date(now).toISOString(),output_sha256:P.sha256(out),origin:process.env.GITHUB_ACTIONS==='true'?'github_actions':'development_automation',out};
 try{fs.writeFileSync(file,JSON.stringify(record)+'\n',{flag:'wx'});return {saved:true,file};}catch(e){if(e.code==='EEXIST')return {saved:false,reason:'already-frozen',file};throw e;}
}
module.exports={freeze};
