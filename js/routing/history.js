(function(root){'use strict';
const P=typeof module!=='undefined'?require('../model-provenance.js'):root.ModelProvenance,KEY='tk-keirin-routed-history/v1';
function snapshot(out,savedAt){
 const saved=Date.parse(savedAt),source=Date.parse(out.input.source?.generated_at),cutoff=Date.parse(out.cutoff),asof=Date.parse(out.as_of);
 if(!(out.mode==='pre-race'&&Number.isFinite(saved)&&asof<=saved&&saved<cutoff&&Number.isFinite(source)&&source<=asof&&source<cutoff&&out.input.source.mode==='live-public-feed'))return null;
 return {schema:'tk-keirin-routed-frozen/v1',race_id:out.race_id,saved_at:savedAt,cutoff:out.cutoff,model_id:out.model.model_id,policy_version:out.selection.policy_version,requested:out.selection.requested,input_sha256:out.input_sha256,output_sha256:P.sha256(out),out};
}
function save(out,savedAt,storage){
 const record=snapshot(out,savedAt);if(!record)return {status:'replay'};
 let rows;try{rows=JSON.parse(storage.getItem(KEY)||'[]');if(!Array.isArray(rows))rows=[];}catch(_){rows=[];}
 const old=rows.find(r=>r.race_id===record.race_id&&r.model_id===record.model_id&&r.requested===record.requested);if(old)return {status:'existing',record:old};
 storage.setItem(KEY,JSON.stringify([...rows,record].slice(-40)));return {status:'saved',record};
}
const api={KEY,snapshot,save};if(typeof module!=='undefined')module.exports=api;root.RoutedHistory=api;
})(typeof globalThis!=='undefined'?globalThis:this);
