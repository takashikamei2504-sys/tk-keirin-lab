#!/usr/bin/env node
'use strict';
/* Research only. Sharded retrospective eight-engine study on strictly inferred lines.
 * Results are selection-biased, not the entire preceding 90 days.
 */
const fs=require('node:fs'),path=require('node:path');
const Feed=require('../js/race-feed.js'),Policy=require('../js/routing/policy.js');
const Router=require('../js/routing/router.js'),B=require('../js/b-upset/engine.cjs');
const E=require('../js/b-upset/evaluation.cjs');
const root=path.resolve(__dirname,'../reports/year-race-type');
const file=path.join(root,'extended180-comment-inputs-temporary.json');
const source=JSON.parse(fs.readFileSync(file,'utf8'));
if(source.summary?.schema!=='tk-keirin-extended180-comment-reconstructed-prep/v1'||!Array.isArray(source.cards))
 throw Error('Missing source audit');
if(source.summary.cross_source_verification?.counts?.disagreed)throw Error('Baseline mismatch');
const shard=Number(process.env.YEAR_EXT_SHARD),total=Number(process.env.YEAR_EXT_TOTAL||12);
if(!Number.isInteger(shard)||!Number.isInteger(total)||total<1||total>24||shard<0||shard>=total)throw Error('Shard invalid');
const ways=['auto','physical','causal','lab_v5','line','roi_coverage','b_upset_ad','b_upset_expanded'];
const selected=source.cards.filter((_,i)=>i%total===shard),rows=[],failures={};
function fail(engine,id,reason){const f=failures[engine]??={count:0,examples:[]};f.count++;if(f.examples.length<4)f.examples.push(id+': '+String(reason).slice(0,150))}
for(const src of selected){
 const raceId=src.date+':'+src.venue+':'+src.race_no;
 try{
  if(src.line_source!=='strict_named_comment_inference')throw Error('Wrong line source');
  const observed={combos:src.observed.combos};
  if(!observed.combos?.length||observed.combos.some(x=>!x.key||!Number.isInteger(x.payout)||x.payout<=0))throw Error('Invalid trifecta');
  const card={entries:src.entries,venue:src.venue,race_number:src.race_no,start_time:src.start_time,
   round_name:'未取得',grade:'未確認',is_girls:false};
  const raw=Feed.convert(card,{date:src.date,generated_at:''});
  raw.source={mode:'historical-archive-replay',label:'Historical inferred rider-comment lineup',
   verified:false,lineup_verified:false,generated_at:'',
   missing_fields:['verified_lineup','published_round','s','b','wins','recent','ex']};
  const category=Policy.classify(raw).key;
  if(category!==src.category)throw Error('Wrong grade '+category);
  const at=Date.parse(src.date+'T'+src.start_time+':00+09:00')-600000;
  const predictions={},models={};
  for(const name of ways.filter(x=>!x.startsWith('b_upset'))){
   try{
    const out=Router.build(raw,{}, {asOf:at,engine:name});
    if(out.race_id!==raceId)throw Error('Race ID mismatch');
    predictions[name]=E.settle(out.tickets.map(t=>t.key),observed);
    models[name]=out.model?.model_id||null;
   }catch(e){fail(name,raceId,e.message)}
  }
  try{
   const out=B.build(raw,{asOf:at,replay:true});
   if(out.race_id!==raceId)throw Error('Race ID mismatch');
   predictions.b_upset_ad=E.settle(out.research.ad.map(x=>x.key),observed);
   predictions.b_upset_expanded=E.settle(out.research.expanded.map(x=>x.key),observed);
   models.b_upset_ad=out.model?.model_id||null;
   models.b_upset_expanded=models.b_upset_ad;
  }catch(e){fail('b_upset',raceId,e.message)}
  if(ways.some(x=>!predictions[x]))fail('missing_engine',raceId,'Engine missing');
  rows.push({race_id:raceId,date:src.date,category,model_ids:models,predictions,
   source_result:src.result_source});
 }catch(e){fail('invalid',raceId,e.message)}
 if(rows.length%20===0)console.log('EXT180_SHARD_PROGRESS',shard,rows.length,'/',selected.length);
}
const o={schema:'tk-keirin-extend180-comment-eights-shard/v1',shard,total,
  processed:selected.length,rows,failures,
  source_ref:source.summary.source?.entries_results,
  note:'strict inferred comments; not observed full 180-day population'};
const dir=path.join(root,'extend180-comment-shards');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'part-'+shard+'.json'),JSON.stringify(o)+'\n');
console.log('EXT180_SHARD_DONE',JSON.stringify({shard,total,processed:selected.length,rows:rows.length,failures}).slice(0,4000));
if(rows.length!==selected.length||rows.some(r=>ways.some(w=>!r.predictions[w]))||Object.keys(failures).length)process.exitCode=2;
