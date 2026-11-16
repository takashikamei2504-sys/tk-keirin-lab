#!/usr/bin/env node
'use strict';
/* Replay unchanged current 8 engines on historical source-complete 2025/2026 cards.
 * Input is pre-race information only, archived and fetched after race.
 * NO future model integrity claim; never label this true frozen pre-race performance.
 */
const fs=require('node:fs'),path=require('node:path');
const Feed=require('../js/race-feed.js'),Policy=require('../js/routing/policy.js');
const Router=require('../js/routing/router.js'),B=require('../js/b-upset/engine.cjs');
const E=require('../js/b-upset/evaluation.cjs');
const dir=path.resolve(__dirname,'../reports/year-race-type');
const file=path.join(dir,'annual-60-card-input-audit.json');
const source=JSON.parse(fs.readFileSync(file,'utf8'));
const WAYS=['auto','physical','causal','lab_v5','line','roi_coverage','b_upset_ad','b_upset_expanded'];
if(source.schema!=='tk-keirin-2025-26-fullcard-pilot/v1'||source.cards?.length>60)throw Error('Unexpected source data');
const offset=Number(process.env.YEAR_OFFSET||0),max=Number(process.env.YEAR_LIMIT||20);
const part=Number(process.env.YEAR_PART||0);
if(!Number.isInteger(offset)||!Number.isInteger(max)||offset<0||offset>60||max<1||max>60||part<0||part>9)throw Error('Invalid shard slice');
function roundName(title){
 const t=String(title||'').normalize('NFKC').replace(/\s+/g,'');
 const m=t.match(/\d{1,2}R((?:S級|A級|チャレンジ)?(?:初特選|初日特選|準決勝|準々決勝|決勝|特予選|予選|特一般|一般|特選|選抜|特秀|特優|特別選抜|特別優秀))/);
 return m?m[1]:null;
}
if(roundName('伊東競輪レース詳細|広告は静岡テレビセンター杯11R決勝|2026年04月15日')!=='決勝')throw Error('Failed grade-omitted final parser');
const overall=(r,e)=>E.metrics(r.map(x=>x.predictions[e]));
const failures={};const fail=(k,why)=>{(failures[k]??={count:0,examples:[]}).count++;if(failures[k].examples.length<3)failures[k].examples.push(String(why).slice(0,200))};
const rows=[];let excluded=0;
for(const src of source.cards.slice(offset,offset+max)){
 if(src.status!=='ready'){excluded++;continue}
 try{
  const name=roundName(src.published_round);
  if(!name){fail('invalid_program','No original round label');continue}
  const raceNo=Number(src.race_id.slice(-4));
  const card={entries:src.entries,start_time:src.start_time,venue:src.venue,race_number:raceNo,
       round_name:name,grade:src.grade,is_girls:false};
  const raw=Feed.convert(card,{date:src.date,generated_at:''});
  raw.source={mode:'historical-archive-replay',label:'K-Dreams historical published lineup and CSV racecard; replay',url:src.source_url,generated_at:'',verified:false,missing_fields:['s','b','wins','recent','ex']};
  const category=Policy.classify(raw).key;
  if(category!==src.category)throw Error('Grade mismatch '+category+' versus '+src.category);
  const asOf=Date.parse(src.date+'T'+raw.start+':00+09:00')-600000;
  const combos=src.result_combos.map(x=>({key:x.combo.join('-'),trio:x.combo,payout:x.payout}));
  const obs={combos};
  const predictions={},modelIds={};
  for(const name of WAYS.filter(x=>!x.startsWith('b_upset'))){
    try {
      const p=Router.build(raw,{}, {asOf,engine:name});
      predictions[name]=E.settle(p.tickets.map(t=>t.key),obs);
      modelIds[name]=p.model?.model_id||null;
    }catch(e1){fail(name,e1.message)}
  }
  try{
    const p=B.build(raw,{asOf,replay:true});
    predictions.b_upset_ad=E.settle(p.research.ad.map(x=>x.key),obs);
    predictions.b_upset_expanded=E.settle(p.research.expanded.map(x=>x.key),obs);
    modelIds.b_upset_ad=p.model?.model_id||null;modelIds.b_upset_expanded=modelIds.b_upset_ad;
  }catch(e){fail('b_upset',e.message)}
  rows.push({race_id:src.race_id,date:src.date,category,stage:src.inferred_stage,
     stage_label:name,cars:src.entries.length,venue:src.venue,start:raw.start,
     line_groups:src.line_groups,modelIds,predictions,
     source_url:src.source_url,source_selection:src.source_selection});
 }catch(e){fail('card',e.message)}
}
const complete=rows.filter(r=>WAYS.every(e=>r.predictions[e]));
const summary={schema:'tk-keirin-archive-lineup-8engine-shard/v1',
 source:'historical K-Dreams published lineups, Kenseimk rider scores and class, retrospective current-code replay',
 scope:{offset,max,part,covered:source.cards.slice(offset,offset+max).length,
       source_ready:source.prepared_n,source_sample:source.sample_n,evaluated:rows.length,common_complete:complete.length,
       input_clock:'original historical provider scheduled start (no invented start)',
       caution:'This is a small nonrepresentative historical source feasibility test, not the annual ROI study.'},
 failures,rows,common:Object.fromEntries(WAYS.map(e=>[e,overall(complete,e)]))
};
const out=path.join(dir,'archive-replay-part-'+part+'.json');
fs.writeFileSync(out,JSON.stringify(summary,null,2)+'\n');
console.log('HISTORIC_ENGINE_SHARD',JSON.stringify({scope:summary.scope,failures,common:Object.fromEntries(WAYS.map(e=>[e,{roi:summary.common[e].roi,hits:summary.common[e].hits}]))},null,2));
