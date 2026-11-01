/* Result accounting only. Never imported by the prediction engine. */
(function(root){'use strict';
const SCHEMA='tk-keirin-outcomes/v1';
const raceKey=r=>`${r.date}:${r.venue}:${r.race_no}`;
const startAt=r=>Date.parse(`${r.date}T${r.start}:00+09:00`);
const identity=r=>r.riders.map(x=>[x.no,String(x.meta?.rider_id||''),String(x.name).replace(/[\s\u3000]/g,'')]).sort((a,b)=>a[0]-b[0]);
function combo(v,ids){return Array.isArray(v)&&v.length===3&&new Set(v).size===3&&v.every(n=>Number.isInteger(n)&&ids.includes(n));}
function result(source,day,collectedAt){
 const ids=(source.entries||[]).map(e=>Number(e.car_number));
 if(source.is_girls||![7,9].includes(ids.length)||new Set(ids).size!==ids.length||ids.some(n=>!Number.isInteger(n)||n<1||n>9))return null;
 const cutoff=Date.parse(`${day.date}T${source.start_time}:00+09:00`),collected=Date.parse(collectedAt),updated=Date.parse(day.generated_at);
 if(!Number.isFinite(cutoff)||!Number.isFinite(collected)||!Number.isFinite(updated)||cutoff>=collected||updated<=cutoff||updated>collected)return null;
 const rows=source.result_combos?.length?source.result_combos:source.payouts?.trifecta?.length?source.payouts.trifecta:combo(source.result_top3,ids)?[{combo:source.result_top3,payout:source.payout_trifecta}]:[];
 if(!rows.length)return null;
 const unique=new Map();
 for(const row of rows){if(!combo(row.combo,ids))throw Error('結果の車番・同着組合せが不正です');const key=row.combo.join('-');
  const payout=Number.isInteger(row.payout)&&row.payout>0?row.payout:null;
  if(unique.has(key)&&unique.get(key).payout!==payout)throw Error('同じ結果の払戻が矛盾しています');unique.set(key,{key,trio:row.combo,payout});}
 if(combo(source.result_top3,ids)&&!unique.has(source.result_top3.join('-')))throw Error('結果欄が相互に矛盾しています');
 const places=source.result_places;
 if(Array.isArray(places)&&places.length>=3&&places.some(p=>p.length)){
  const allowed=[[],[],[]];
  for(let rank=0;rank<3;rank++){
   if(!Array.isArray(places[rank]))throw Error('着順欄が不正です');
   const group=places[rank];
   if(allowed[rank].length&&group.length)throw Error('同着の占有着順が矛盾しています');
   for(let offset=0;offset<group.length&&rank+offset<3;offset++)allowed[rank+offset]=group;
  }
  for(const row of unique.values())for(let rank=0;rank<3;rank++)if(!allowed[rank].includes(row.trio[rank]))throw Error('着順欄と結果組合せが一致しません');
  const expected=new Set();for(const a of allowed[0])for(const b of allowed[1])for(const c of allowed[2])if(new Set([a,b,c]).size===3)expected.add([a,b,c].join('-'));
  if(expected.size!==unique.size||[...expected].some(k=>!unique.has(k)))throw Error('同着の有効組合せが不足しています');
 }
 const race={date:day.date,venue:String(source.venue),race_no:Number(source.race_number),start:source.start_time,riders:source.entries.map(e=>({no:Number(e.car_number),name:String(e.rider_full_name||e.rider_name||'').replace(/[\s\u3000]/g,''),meta:{rider_id:String(e.rider_id||'')}}))};
 if(!race.venue||!Number.isInteger(race.race_no)||race.race_no<1||race.race_no>12)throw Error('結果のレース識別が不正です');
 return {race_id:raceKey(race),race,identity:identity(race),combos:[...unique.values()],source_updated_at:day.generated_at,collected_at:collectedAt,
  source_url:`https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/${day.date}.json`,verification:'public_feed_unverified',status:'reported',note:'公開配信の着順・払戻欄。公式原本との独立照合は未実施'};
}
function snapshot(r,out,savedAt,{origin='browser',evidence=[],baseline=null}={}){
 const time=Date.parse(savedAt),cutoff=startAt(r),sourceTime=Date.parse(r.source?.generated_at);
 const eligible=Number.isFinite(time)&&time<cutoff&&Number.isFinite(sourceTime)&&sourceTime<cutoff&&sourceTime<=time&&r.source?.mode==='live-public-feed';
 const input={...r,riders:r.riders.map(x=>{const rider={...x};if(x.recent_form){rider.recent_form={...x.recent_form};delete rider.recent_form.recent_meetings;delete rider.recent_form.current_meeting_results;}return rider;})};
 const chosen=out.chosen.map(t=>({key:t.key,trio:t.trio,mode:t.supporting_path.mode,explanation:t.supporting_path.explanation}));
 if(chosen.length!==20||new Set(chosen.map(t=>t.key)).size!==20||chosen.some(t=>!combo(t.trio,r.riders.map(x=>x.no))||t.key!==t.trio.join('-')))throw Error('保存対象の20点が不正です');
 return {schema:SCHEMA,race_id:raceKey(r),version:out.version,saved_at:savedAt,cutoff:new Date(cutoff).toISOString(),pre_race:eligible,origin,
  identity:identity(r),input,chosen,ranked_keys:out.tickets.map(t=>t.key),evidence,diagnostics:out.diagnostics,baseline,
  note:eligible?'発走前の予想を固定保存':'発走後・サンプル・資料時刻不明のため成績集計対象外'};
}
function evaluate(prediction,observed){
 if(!prediction)return {status:'no_prediction',category:'事前予想なし'};
 if(!prediction.pre_race||Date.parse(prediction.cutoff)!==startAt(prediction.input)||!(Date.parse(prediction.saved_at)<startAt(prediction.input))||prediction.race_id!==observed.race_id)return {status:'excluded',category:'発走前の保存記録なし'};
 if(JSON.stringify(prediction.identity)!==JSON.stringify(observed.identity)||prediction.input.start!==observed.race.start)return {status:'excluded',category:'出走者・発走時刻が保存時から変化'};
 const keys=new Set(prediction.chosen.map(t=>t.key)),winning=observed.combos.map(c=>c.key),hit=winning.some(k=>keys.has(k));
 const bestRank=Math.min(...winning.map(k=>{const i=prediction.ranked_keys.indexOf(k);return i<0?Infinity:i+1;}));
 let category='的中';
 if(!hit){const heads=new Set(prediction.chosen.map(t=>t.trio[0])),pairs=new Set(prediction.chosen.map(t=>t.trio.slice(0,2).join('-')));
  category=!observed.combos.some(c=>heads.has(c.trio[0]))?'1着候補漏れ':!observed.combos.some(c=>pairs.has(c.trio.slice(0,2).join('-')))?'1・2着の組合せ漏れ':'3着候補漏れ';}
 return {status:'evaluated',hit,category,best_rank:Number.isFinite(bestRank)?bestRank:null,selection_miss:!hit&&Number.isFinite(bestRank),
  baseline_hit:Array.isArray(prediction.baseline?.chosen)?winning.some(k=>prediction.baseline.chosen.includes(k)):null,
  hit_modes:[...new Set(prediction.chosen.filter(t=>winning.includes(t.key)).map(t=>t.mode))]};
}
function summarize(rows){
 const evaluated=rows.filter(r=>r.evaluation.status==='evaluated'),hits=evaluated.filter(r=>r.evaluation.hit).length,misses={};
 for(const row of evaluated.filter(r=>!r.evaluation.hit))misses[row.evaluation.category]=(misses[row.evaluation.category]||0)+1;
 const paired=evaluated.filter(r=>r.evaluation.baseline_hit!==null),newHits=paired.filter(r=>r.evaluation.hit).length,oldHits=paired.filter(r=>r.evaluation.baseline_hit).length;
 const recommendations=Object.entries(misses).sort((a,b)=>b[1]-a[1]).map(([reason,count])=>({reason,count,action:({'1着候補漏れ':'前受け・主導権・終盤の1着候補の重みを比較する','1・2着の組合せ漏れ':'番手残り・別線追込みと2着選定を比較する','3着候補漏れ':'3着候補の絞り方と20点への配分を比較する'})[reason]}));
 return {evaluated:evaluated.length,hits,hit_rate:evaluated.length?hits/evaluated.length:null,pending:rows.filter(r=>r.evaluation.status==='pending').length,
  excluded:rows.filter(r=>r.evaluation.status==='excluded'||r.evaluation.status==='no_prediction').length,misses,paired:{count:paired.length,new_hits:newHits,baseline_hits:oldHits},recommendations,
  caveat:'着順だけでは突っ張り・追走離れ等の実際の展開を確定できません。改善候補を蓄積し、モデル係数や選手特性は自動変更しません。'};
}
const api={SCHEMA,raceKey,startAt,identity,result,snapshot,evaluate,summarize};if(typeof module!=='undefined')module.exports=api;root.ResultsAudit=api;
})(typeof globalThis!=='undefined'?globalThis:this);
