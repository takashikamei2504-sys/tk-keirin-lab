/* Adapt existing engines without changing their searches or ranked selections. */
(function(root){'use strict';
const Policy=typeof module!=='undefined'?require('./policy.js'):root.RaceRoutingPolicy;
const P=typeof module!=='undefined'?require('../model-provenance.js'):root.ModelProvenance;
const Counts=typeof module!=='undefined'?require('../s-counts.js'):root.SCounts;
const Recent=typeof module!=='undefined'?require('../recent-form.js'):root.RecentForm;
const Material=typeof module!=='undefined'?require('../race-material.js'):root.RaceMaterial;
const Input=typeof module!=='undefined'?require('../line/input.js'):root.LineInput;
const C=typeof module!=='undefined'?require('../race-brain.js'):root.CausalRaceBrain;
const S=typeof module!=='undefined'?require('../story-brain.js'):root.StoryRaceBrain;
const L=typeof module!=='undefined'?require('../line/engine.js'):root.LineEngine;
const ROI=typeof module!=='undefined'?require('../roi/engine.cjs'):root.ROIHypotheses;
const Build=typeof module!=='undefined'?require('./build.js'):root.RaceRouterBuild;
const clone=x=>JSON.parse(JSON.stringify(x));
const phase=s=>({phase:s.phase,order:s.order.slice(),text:s.action||s.events?.map(e=>e.reason).filter(Boolean).join('。')||''});
const rid=r=>r.date+':'+r.venue+':'+r.race_no;
function storySource(r,pack){
 const o=S.build(r,pack),slim=s=>({id:s.id,reading:s.reading,audit:s.audit,scenes:s.scenes.map(s=>({phase:s.phase,order:s.order.slice(),action:s.action}))});
 return {model_id:o.model.model_id,version:o.version,story:{main:slim(o.story.main),alternatives:o.story.alternatives.map(slim)},chosen:o.chosen.map(t=>({key:t.key,trio:t.trio,mode:t.mode,group:t.group,story_id:t.supporting_path.id,explanation:t.supporting_path.scenes[5].action,reason:t.selection_reason}))};
}
function lineSource(r,packs,at){
 const o=L.build(r,packs,{asOf:at,replay:at>=Date.parse(r.date+'T'+r.start+':00+09:00')}),slim=h=>({id:h.id,score:h.score,audit:h.audit,finish:h.finish,scenes:h.scenes.map(s=>({phase:s.phase,order:s.order.slice(),events:s.events.map(e=>({reason:e.reason}))}))});
 return {model_id:o.provenance.model.model_id,version:o.version,chosen:o.tickets.map(t=>({key:t.key,trio:t.trio,hypothesis:t.hypothesis,supporting_hypotheses:t.supporting_hypotheses,variation:t.variation,reason:t.reason})),out:{main:slim(o.main),alternatives:o.alternatives.map(slim),decision:o.decision,provenance:o.provenance}};
}
function build(raw,packs={},options={}){
 const at=options.asOf??Date.now(),selection=Policy.select(raw,options.engine||'auto'),limit=8;
 if(!Number.isFinite(at))throw Error('予想の情報時点が不正です');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(raw.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.start)||!Number.isInteger(raw.race_no)||!raw.venue)throw Error('レースの識別情報が不正です');
 const cutoff=Date.parse(raw.date+'T'+raw.start+':00+09:00');if(!Number.isFinite(cutoff))throw Error('発走時刻が不正です');
 let r=clone(raw);delete r.results;delete r.result;delete r.payouts;
 if(at>=cutoff&&r.source?.mode==='live-public-feed')r.source={...r.source,original_mode:r.source.mode,mode:'historical-archive-replay'};
 r=Material.attach(Recent.attach(Counts.attach(r,packs.s,at),packs.recent||{},at),packs.material||{},at);
 // One shared input boundary removes outcomes, odds and unsupported enrichment.
 r=Input.prepare(r,{},at).race;
 const contextual={...(r.ex_context||{})},obs=packs.ex?.race_contexts?.[rid(r)];
 if(obs&&Date.parse(obs.collected_at)<cutoff&&Date.parse(obs.collected_at)<=at){contextual.weather=obs.weather;contextual.weather_source_verified=Boolean(obs.weather);}
 r.ex_context=contextual;
 let tickets=[],paths=[],sources={};
 const add=(source,id,title,scenes,summary='')=>{const key=source+':'+String(id);if(!paths.some(p=>p.id===key))paths.push({id:key,source,title,summary,scenes:scenes.map(phase)});return key;};
 if(['physical','causal'].includes(selection.engine)){
  const o=C.build(r,{...(packs.intelligence||{}),transitionMode:selection.engine==='physical'?'physical_v2':'legacy',exPack:packs.ex,exAsOf:at,observations:[...(packs.intelligence?.observations||[]),...(r.race_material?.comments||[])]});
  sources[selection.engine]={version:o.version,transition_mode:o.transition_mode};
  tickets=o.chosen.slice(0,limit).map(t=>{const p=t.supporting_path,id=P.sha256({mode:p.mode,trio:p.trio,snapshots:p.snapshots}).slice(0,16);return {key:t.key,trio:t.trio,reason:t.selection_reason,paths:[add(selection.label,id,C.MODES[p.mode]||p.mode,p.snapshots,p.explanation)]};});
 }else if(selection.engine==='lab_v5'){
  const o=storySource(r,packs.intelligence||{}),all=[o.story.main,...o.story.alternatives];sources.LAB={model_id:o.model_id,version:o.version};
  tickets=o.chosen.slice(0,limit).map(t=>{const p=all.find(p=>p.id===t.story_id);if(!p)throw Error('買い目に対応する展開がありません');return {key:t.key,trio:t.trio,reason:t.reason,paths:[add('LAB',p.id,p.reading||'別筋の展開',p.scenes,t.explanation)]};});
 }else if(selection.engine==='line'){
  const o=lineSource(r,packs,at),all=[o.out.main,...o.out.alternatives];sources.LINE={model_id:o.model_id,version:o.version};
  tickets=o.chosen.slice(0,limit).map(t=>({key:t.key,trio:t.trio,reason:t.reason||t.variation?.mode||'',paths:[...new Set([t.hypothesis,...(t.supporting_hypotheses||[])])].map(id=>all.find(p=>p.id===id)).filter(Boolean).map(p=>add('LINE',p.id,p.finish.mode,p.scenes))}));
 }else{
  const story=storySource(r,packs.intelligence||{}),line=lineSource(r,packs,at),common={race_id:rid(r),identity:r.riders.map(x=>[x.no,String(x.meta?.rider_id||''),String(x.name).replace(/[\s\u3000]/g,'')]).sort((a,b)=>a[0]-b[0]),input:r,cutoff:new Date(cutoff).toISOString(),saved_at:new Date(at).toISOString()};
  // These are in-memory source outputs; no historical forecast time is fabricated.
  const o=ROI.build({...common,...story},{...common,...line});if(!o)throw Error('同一レースの予想を統合できません');
  sources={LAB:{model_id:story.model_id,version:story.version},LINE:{model_id:line.model_id,version:line.version},ROI:o.model};
  const maps={LAB:[story.story.main,...story.story.alternatives],LINE:[line.out.main,...line.out.alternatives]};
  tickets=o.chosen.slice(0,limit).map(t=>({key:t.key,trio:t.trio,reason:t.evidence.map(e=>e.reason).join(' ／ '),paths:[...new Set(t.evidence.map(e=>{const p=maps[e.source].find(p=>String(p.id)===String(e.path));if(!p)throw Error('統合買い目の根拠がありません');return add(e.source,p.id,p.reading||p.finish?.mode||'別筋の展開',p.scenes,e.reason);} ))]}));
 }
 const ids=r.riders.map(x=>x.no);if(!tickets.length||new Set(tickets.map(t=>t.key)).size!==tickets.length||tickets.some(t=>t.trio?.length!==3||new Set(t.trio).size!==3||t.trio.some(n=>!ids.includes(n))||t.key!==t.trio.join('-')||!t.paths.length))throw Error('選定した買い目・対応展開が不正です');
 const model={...Build,model_id:Build.model_id+'/'+selection.engine+'/8'},input_hash=P.sha256({race:r,intelligence:P.scope(r,packs.intelligence||{}),sources,ex:packs.ex?P.sha256(packs.ex):null});
 return {schema:'tk-keirin-routed-prediction/v1',version:Build.version,model,selection,race:{date:r.date,venue:r.venue,race_no:r.race_no,start:r.start},race_id:rid(r),as_of:new Date(at).toISOString(),cutoff:new Date(cutoff).toISOString(),mode:at<cutoff?'pre-race':'replay',input:r,sources,input_sha256:input_hash,tickets,paths};
}
const snapshot=(typeof module!=='undefined'?require('./history.js'):root.RoutedHistory).snapshot;
const api={build,snapshot,policy:Policy};if(typeof module!=='undefined')module.exports=api;root.RaceRouter=api;
})(typeof globalThis!=='undefined'?globalThis:this);
