'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const Archive=require('./mansha-study.cjs'),Feed=require('../js/race-feed.js');
const Engine=require('../js/b-upset/engine.cjs'),Eval=require('../js/b-upset/evaluation.cjs');
const Patterns=require('../js/b-upset/patterns.cjs'),Audit=require('../js/results-audit.js');
const BResults=require('./b-upset-results.cjs'),Daily=require('./b-upset-daily.cjs');
const root=path.resolve(__dirname,'..'),dest=path.join(root,'data/b_upset');
const read=(f,fallback=null)=>fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):fallback;
const write=(f,d)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(d)+'\n');};
const period=date=>date<'2026-09-01'?'development':date<'2026-10-01'?'validation':'evaluation';

function descriptive(items){
  const bins={};
  for(const item of items){
    const key=item.pattern;
    (bins[key]??=[]).push(item);
  }
  return Object.fromEntries(Object.entries(bins).sort().map(([key,rows])=>{
    const pay=rows.map(r=>r.payout).sort((a,b)=>a-b),n=pay.length;
    return [key,{n,rate:n/items.length,average:pay.reduce((a,b)=>a+b,0)/n,median:(pay[Math.floor((n-1)/2)]+pay[Math.floor(n/2)])/2,
      mid50to100:pay.filter(p=>p>=5000&&p<10000).length,over100:pay.filter(p=>p>=10000).length,
      b_leader_top2:rows.filter(r=>r.b_positions[0]>0&&r.b_positions[0]<=2).length,
      b_second_top2:rows.filter(r=>r.b_positions[1]>0&&r.b_positions[1]<=2).length,
      role_position_distribution:Object.fromEntries(['b_positions','f_positions'].map(role=>[role,[0,1].map(index=>Object.fromEntries([0,1,2,3].map(place=>[place,rows.filter(r=>r[role][index]===place).length])))]))}];
  }));
}

async function main(){
  const start='2026-05-08',end='2026-11-07',cache=path.join(os.tmpdir(),'b-upset-public-days');
  fs.mkdirSync(cache,{recursive:true});
  const dates=Archive.dateList(start,end),days=[],missing=[],errors=[];
  for(let i=0;i<dates.length;i+=6){
    const batch=await Promise.all(dates.slice(i,i+6).map(async date=>{
      const file=path.join(cache,date+'.json');
      if(fs.existsSync(file))return read(file);
      const data=await Archive.fetchDay(date);write(file,data);return data;
    }));
    for(const d of batch){if(d.data)days.push(d);else if(d.missing)missing.push(d.date);else errors.push(d);}
  }
  const cards=[],expected=new Map(),excluded={},lineCompositions=[];
  for(const day of days)for(const source of day.data){
    try{
      if(source.is_girls||![7,9].includes(source.entries?.length))continue;
      const raw=Feed.convert(source,{date:day.date,generated_at:''});
      require('../js/routing/policy.js').classify(raw);
      // Basic-card archive replays: no claim the archive itself is a frozen prediction.
      raw.source.mode='historical-archive-replay';
      const result=Audit.result(source,{date:day.date,generated_at:day.date+'T23:59:59+09:00'},new Date().toISOString());
      if(!result||result.combos.some(c=>!c.payout))continue;
      result.source_updated_at=null;
      result.verification='archived_result_label_metadata_time_unknown';
      expected.set(result.race_id,result);
      const ranking=Engine.rankLines(raw,null);
      for(const line of ranking.lines.filter(l=>l.id!==ranking.favorite))for(const c of result.combos){
        lineCompositions.push({...Patterns.classify(c.trio,raw.lineup,ranking.favorite,line.id),payout:c.payout});
      }
      const hash=crypto.createHash('sha256').update(result.race_id).digest('hex');
      cards.push({raw,result,hash,category:require('../js/routing/policy.js').classify(raw).key});
    }catch(e){excluded[e.message]=(excluded[e.message]||0)+1;}
  }
  // Fixed hash sampling within day/category, independent of outcome/payout/B.
  // It bounds simulation work while retaining every available day in the inventory.
  const bins={};for(const card of cards)(bins[card.raw.date+'|'+card.category]??=[]).push(card);
  const sample=Object.values(bins).flatMap(rows=>rows.sort((a,b)=>a.hash.localeCompare(b.hash)).slice(0,2));
  const replay=[],simulationErrors=[];
  for(const item of sample){
    try{
      const at=Date.parse(item.raw.date+'T'+item.raw.start+':00+09:00')-1;
      const out=Engine.build(item.raw,{asOf:at,replay:true}),normal=Engine.build(item.raw,{asOf:at,replay:true,normal:true});
      const views={};
      for(const name of ['ad','expanded','all_candidates','third_all'])views[name]=Eval.settle(out.research[name].map(t=>typeof t==='string'?t:t.key),item.result);
      views.normal=Eval.settle(normal.research.expanded.map(t=>t.key),item.result);
      views.roi_ev=Eval.settle([],item.result);
      const patterns={};
      for(const p of Object.keys(Patterns.LABELS))patterns[p]=Eval.settle(out.research.expanded.filter(t=>t.pattern===p).map(t=>t.key),item.result);
      replay.push({race_id:out.race_id,date:out.race.date,start:out.race.start,cars:out.race.cars,category:item.category,
        views,patterns,primary_b:out.scenarios[0]?.b_no||null,b_lines:[...new Set(out.scenarios.map(s=>s.b_line))]});
    }catch(e){simulationErrors.push({race_id:item.result.race_id,error:e.message});}
  }
  replay.sort((a,b)=>(a.date+'T'+a.start).localeCompare(b.date+'T'+b.start)||a.race_id.localeCompare(b.race_id));
  const summarize=rows=>({n:rows.length,
    views:Object.fromEntries(['ad','expanded','all_candidates','third_all','normal','roi_ev'].map(key=>[key,Eval.metrics(rows.map(r=>r.views[key]))])),
    patterns:Object.fromEntries(Object.keys(Patterns.LABELS).map(key=>[key,Eval.metrics(rows.map(r=>r.patterns[key]))]))});
  // Independent actual B collection advances by at most 64 venue/day pages per run.
  const progress=read(path.join(dest,'archive-progress.json'),{checked_pages:[]});
  const pageLimit=Number(process.env.B_UPSET_PAGES??64);
  if(!Number.isInteger(pageLimit)||pageLimit<0||pageLimit>64)throw Error('B_UPSET_PAGES must be 0..64');
  const collected=await BResults.collect(expected,read(path.join(dest,'actual_b_archive.json'),{}),pageLimit,progress.checked_pages);
  write(path.join(dest,'actual_b_archive.json'),collected.records);
  write(path.join(dest,'archive-progress.json'),{generated_at:new Date().toISOString(),checked_pages:[...new Set([...progress.checked_pages,...collected.checked_pages])]});
  const actualPatterns=[];
  for(const card of cards){
    const b=collected.records[card.result.race_id];if(!b)continue;
    const mapping=Patterns.membership(card.raw.lineup),back=mapping.get(b.b_no)?.line_id,ranking=Engine.rankLines(card.raw,'archive');
    if(!back||back===ranking.favorite)continue;
    for(const c of card.result.combos)actualPatterns.push({...Patterns.classify(c.trio,card.raw.lineup,ranking.favorite,back),payout:c.payout});
  }
  const knownReplay=replay.filter(r=>collected.records[r.race_id]);
  // Shared-race LAB/LINE comparison uses existing frozen tickets, never reruns LAB.
  const lab=read(path.join(root,'data/lab_evaluation.json'),{}).rows||[];
  const line=read(path.join(root,'data/line_evaluation.json'),{}).rows||[];
  const common=[];
  for(const row of replay){
    const l=lab.find(x=>x.race_id===row.race_id&&x.evaluation?.status==='evaluated'&&x.history_url);
    const n=line.find(x=>x.race_id===row.race_id&&x.evaluation?.status==='evaluated');
    if(!l||!n)continue;
    try{
      const a=read(path.join(root,l.history_url)),file=crypto.createHash('sha256').update(n.race_id+'|'+n.model_id).digest('hex')+'.json';
      const b=read(path.join(root,'data/line_history',row.date,file));
      const result=expected.get(row.race_id);
      if(!a?.chosen||!b?.out?.tickets)continue;
      if(JSON.stringify(Audit.identity(a.input))!==JSON.stringify(result.identity)||JSON.stringify(Audit.identity(b.out.input.race))!==JSON.stringify(result.identity))continue;
      common.push({race_id:row.race_id,LAB:Eval.settle(a.chosen.map(t=>t.key),result),LINE:Eval.settle(b.out.tickets.map(t=>t.key),result),AD:row.views.ad,AH:row.views.expanded,EV:row.views.roi_ev});
    }catch(e){/* Comparisons without both immutable source records remain unavailable. */}
  }
  const result={schema:'tk-b-upset-research/v2',generated_at:new Date().toISOString(),model:require('../js/b-upset/build.json'),
    scope:{start,end,requested_days:dates.length,available_days:days.length,missing_days:missing,fetch_errors:errors,
      eligible_cards:cards.length,excluded,simulation_sample:sample.length,simulation_errors:simulationErrors,
      sampling:'各日・級班車立てごとにrace_id SHA256昇順の先頭2件。結果や払戻による抽出なし',
      replay_only:true,actual_b_requested_days:[...new Set([...expected.values()].map(r=>r.race.date))].sort(),actual_b_known:Object.keys(collected.records).length,
      actual_nonfavorite_b_finishes:actualPatterns.length,actual_b_errors:collected.errors},
    overall:summarize(replay),by_period:Object.fromEntries(['development','validation','evaluation'].map(key=>[key,summarize(replay.filter(r=>period(r.date)===key))])),
    by_cars:Object.fromEntries([7,9].map(n=>[n,summarize(replay.filter(r=>r.cars===n))])),
    actual_b:{patterns:descriptive(actualPatterns),replay_known:knownReplay.length,
      primary_correct:knownReplay.filter(r=>r.primary_b===collected.records[r.race_id].b_no).length,
      candidate_line_hit:knownReplay.filter(r=>{const card=cards.find(c=>c.result.race_id===r.race_id);return r.b_lines.includes(Patterns.membership(card.raw.lineup).get(collected.records[r.race_id].b_no).line_id);}).length},
    common_frozen_sources:{n:common.length,LAB:Eval.metrics(common.map(r=>r.LAB)),LINE:Eval.metrics(common.map(r=>r.LINE)),AD:Eval.metrics(common.map(r=>r.AD)),AH:Eval.metrics(common.map(r=>r.AH)),EV:Eval.metrics(common.map(r=>r.EV))},
    all_candidate_composition_diagnostic:descriptive(lineCompositions),
    conclusion:'探索・検証の境界は2026-09-01と2026-10-01。ルール固定の再現比較であり新規エンジンの発走前実績ではない。実BがないレースもROIの母集団に残す。B条件の実測発生率は独立B結果が確認できた範囲だけ。購入優位性は未認定。'};
  write(path.join(dest,'research.json'),result);
  console.log(JSON.stringify({scope:result.scope,overall:result.overall.views,actual_b:result.actual_b,common:result.common_frozen_sources}));
  return result;
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={main,descriptive};
