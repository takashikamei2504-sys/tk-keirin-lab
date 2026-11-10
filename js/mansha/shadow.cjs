'use strict';
/**
 * Read-only mansha shadow engine.
 * Requires an already frozen, pre-race automatic LAB forecast. It NEVER feeds
 * back into the normal race router, normal ticket policy, or paid-bet selection.
 */
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const Eval=require('../routing/evaluation.js');
const P=require('../model-provenance.js');
const Risk=require('./risk.js');
require('./model.js');
const model=globalThis.ManshaRiskModel;
const weights=require('./shadow-weights.json');
const SCHEMA='tk-keirin-mansha-shadow/v1';
const VERSION='mansha-shadow-crossline-v1.0';
const weightHash=crypto.createHash('sha256').update(fs.readFileSync(__filename))
 .update(fs.readFileSync(path.join(__dirname,'shadow-weights.json'))).digest('hex');
const MODEL_ID=VERSION+'@'+weightHash.slice(0,16);
const dot=(x,w)=>x.reduce((s,v,i)=>s+v*w[i],0);
const softmax=(z)=>{const max=Math.max(...z),v=z.map(x=>Math.exp(x-max)),total=v.reduce((a,b)=>a+b,0);return v.map(x=>x/total)};
const fingerprint=obj=>P.sha256(obj);
function checkForecast(record) {
 if(!record||record.requested!=='auto'||Eval.evaluate(record).status!=='pending'||record.out.mode!=='pre-race')throw Error('固定された発走前の自動予想だけを対象にします');
 const o=record.out;
 if(![7,9].includes(o.input?.riders?.length))throw Error('男子7/9車の保存予想ではありません');
 const saved=Date.parse(record.saved_at),cut=Date.parse(record.cutoff);
 if(!(Number.isFinite(saved)&&saved<cut))throw Error('発走前の保存時刻がありません');
 const s=Risk.featuresFromRace(o.input),r=Risk.score(s,model);
 return {o,features:s,risk:r};
}
function identity(r) {
 const lineup=r.lineup,byNo=new Map();
 for(let i=0;i<lineup.length;i++)for(let j=0;j<lineup[i].length;j++){
  const no=Number(lineup[i][j]);if(byNo.has(no))throw Error('並びに重複があります');
  byNo.set(no,{line:i,role:j+1,size:lineup[i].length});
 }
 const e=r.riders.map(x=>({...x,no:Number(x.no)}));
 if(byNo.size!==e.length||e.some(x=>!byNo.has(x.no)||!Number.isFinite(Number(x.score))))throw Error('選手とラインの対応が不正です');
 return {byNo,e};
}
function riderCols(x,stats,first=null,second=null) {
 const pos=stats.byNo.get(x.no),sorted=stats.sorted,rank=sorted.findIndex(y=>y.no===x.no),n=stats.e.length;
 return [
  Math.max(-3,Math.min(3,(Number(x.score)-stats.mean)/Math.max(stats.sd,3))),
  (n-1-rank)/(n-1),
  Number(pos.role===1),Number(pos.role===2),Number(pos.role>=3),
  Number(pos.size===1),Number(pos.size>=3),
  Number(x.style==='逃'),Number(x.style==='追'),
  Number(Boolean(first)&&pos.line===stats.byNo.get(first.no).line),
  Number(Boolean(second)&&pos.line===stats.byNo.get(second.no).line),
  Number(Boolean(first&&second)&&pos.line!==stats.byNo.get(first.no).line&&pos.line!==stats.byNo.get(second.no).line)
 ];
}
function prep(input) {
 const s=identity(input),scores=s.e.map(x=>Number(x.score));
 s.mean=scores.reduce((a,b)=>a+b,0)/scores.length;
 s.sd=Math.sqrt(scores.reduce((a,b)=>a+(b-s.mean)**2,0)/scores.length);
 s.sorted=s.e.slice().sort((a,b)=>Number(b.score)-Number(a.score)||a.no-b.no);
 return s;
}
function tacticEvidence(out,stats) {
 const paths=(out.paths||[]).filter(p=>Array.isArray(p.scenes)&&p.scenes.length>=5).slice(0,32);
 const evidence=new Map();
 for(let i=0;i<paths.length;i++){
  const p=paths[i],last=p.scenes.at(-1),finish=last?.order||[];
  if(finish.length!==stats.e.length||new Set(finish).size!==stats.e.length)continue;
  const a=Number(finish[0]),b=Number(finish[1]),pa=stats.byNo.get(a),pb=stats.byNo.get(b);
  if(!pa||!pb||pa.line===pb.line)continue;
  const bScene=p.scenes.find(x=>String(x.phase||'').includes('バック'))||p.scenes[Math.min(3,p.scenes.length-2)];
  const bNo=Number(bScene?.order?.[0]),bLine=stats.byNo.get(bNo)?.line;
  const confidence=1/(1+i*.28);
  const key=a+'-'+b;
  const row=evidence.get(key)||{support:0,paths:[],bRiders:[],bLines:[],reasons:[]};
  row.support+=confidence;
  row.paths.push(p.id);
  if(bLine!=null){row.bRiders.push(bNo);row.bLines.push(bLine)}
  row.reasons.push((p.title||p.source||'展開')+'：'+(last.text||'直線順位'));
  evidence.set(key,row);
 }
 const max=Math.max(1,...[...evidence.values()].map(x=>x.support));
 for(const v of evidence.values())v.support/=max;
 return evidence;
}
function pairRanks(input,evidence,mode) {
 const stats=prep(input),e=stats.e;
 const firstWeights=weights.winner.weights,secondWeights=weights.second.weights;
 const p1=softmax(e.map(x=>dot(riderCols(x,stats),firstWeights)));
 const p2=softmax(e.map(x=>dot(riderCols(x,stats),secondWeights)));
 const out=[];
 for(let i=0;i<e.length;i++)for(let j=0;j<e.length;j++){
  if(i===j||stats.byNo.get(e[i].no).line===stats.byNo.get(e[j].no).line)continue;
  const key=e[i].no+'-'+e[j].no,t=evidence.get(key);
  const base=Math.log(Math.max(p1[i],1e-12))+Math.log(Math.max(p2[j],1e-12));
  // Provisional tactic signal: disabled completely for the baseline.
  // Never fit these constants on the same later races being evaluated.
  const tactical=mode==='tactical'&&t?0.35*t.support:0;
  out.push({key,a:e[i].no,b:e[j].no,score:base+tactical,
    baseline_score:base,tactical_bonus:tactical,
    b_riders:t?.bRiders||[],b_lines:t?.bLines||[],
    path_ids:t?.paths||[],why:t?.reasons?.slice(0,2)||[]});
 }
 out.sort((a,b)=>b.score-a.score||a.a-b.a||a.b-b.b);
 return out;
}
function thirdRanks(stats,pair,scope) {
 const a=stats.e.find(x=>x.no===pair.a),b=stats.e.find(x=>x.no===pair.b);
 const rest=stats.e.filter(x=>x.no!==pair.a&&x.no!==pair.b);
 if(scope==='all')return rest.map(x=>x.no);
 return rest.slice().sort((x,y)=>
   dot(riderCols(y,stats,a,b),weights.third.weights)-dot(riderCols(x,stats,a,b),weights.third.weights)||x.no-y.no).slice(0,2).map(x=>x.no);
}
function variants(stats,pairs,mode) {
 const n=stats.e.length,definitions=[
  {id:'A',label:'最有力別線1組・3着全通り',pairs:1,third:'all'},
  {id:'B',label:'別線2組・3着全通り',pairs:2,third:'all'},
  {id:'C',label:'別線2組・3着順位上位2人',pairs:2,third:'top2'}
 ];
 return definitions.map(d=>{
  const tickets=[],seen=new Set(),evidence=[];
  for(const pair of pairs.slice(0,d.pairs)){
   const nums=thirdRanks(stats,pair,d.third);
   evidence.push({key:pair.key,baseline_score:pair.baseline_score,tactical_bonus:pair.tactical_bonus,
     path_ids:pair.path_ids,b_riders:pair.b_riders,b_lines:pair.b_lines,why:pair.why});
   for(const c of nums){const triple=[pair.a,pair.b,c],key=triple.join('-');
    if(seen.has(key))continue;seen.add(key);tickets.push({key,trio:triple,reason:'別線1・2着：'+pair.key+' ／ '+(d.third==='all'?'3着残り全車':'3着条件付き順位上位2車')});}
  }
  return {...d,engine:mode,scope:n===9&&d.id==='B'?'研究参考（14点・上限10点超過）':'検証専用',
    tickets,evidence,stake_100yen:tickets.length*100};
 });
}
function generate(parent,createdAt) {
 const {o,features,risk}=checkForecast(parent);
 const created=Date.parse(createdAt),cutoff=Date.parse(parent.cutoff);
 if(!(Number.isFinite(created)&&created<cutoff&&created>=Date.parse(parent.saved_at)))throw Error('発走前の確定時刻を満たさないため、後追い予想を保存しません');
 const stats=prep(o.input),evid=tacticEvidence(o,stats);
 const base=pairRanks(o.input,evid,'baseline'),tactical=pairRanks(o.input,evid,'tactical');
 const out={
  schema:SCHEMA,version:VERSION,model_id:MODEL_ID,
  race_id:parent.race_id,created_at:createdAt,original_saved_at:parent.saved_at,
  cutoff:parent.cutoff,parent_output_sha256:parent.output_sha256,parent_record_sha256:fingerprint(parent),
  risk:{probability:risk.probability,percent:risk.percent,band:risk.band,priority:risk.priority,
   version:risk.model_version},pre_race_features:features,
  tactic_sources:{model_ids:o.sources,path_count:(o.paths||[]).length,distinct_crossline_evidence:evid.size},
  modes:[
   {name:'baseline',pair_rank:base.slice(0,5),variants:variants(stats,base,'baseline')},
   {name:'tactical',pair_rank:tactical.slice(0,5),variants:variants(stats,tactical,'tactical')}
  ]
 };
 out.sha256=fingerprint(out);
 return out;
}
function validate(shadow,parent) {
 try{
  const {o}=checkForecast(parent),v={...shadow};delete v.sha256;
  if(shadow.schema!==SCHEMA||shadow.model_id!==MODEL_ID||shadow.race_id!==parent.race_id||
    shadow.parent_record_sha256!==fingerprint(parent)||shadow.parent_output_sha256!==parent.output_sha256||
    shadow.original_saved_at!==parent.saved_at||shadow.cutoff!==parent.cutoff||
    !(Date.parse(shadow.created_at)<Date.parse(parent.cutoff))||shadow.sha256!==fingerprint(v))return false;
  const ids=new Set(o.input.riders.map(r=>r.no)),stats=prep(o.input);
  return shadow.modes?.length===2&&shadow.modes.every(mode=>
    ['baseline','tactical'].includes(mode.name)&&mode.variants?.length===3&&mode.variants.every(variant=>{
    const max=variant.id==='A'?1:2,per=variant.third==='all'?ids.size-2:2;
    if(variant.pairs!==max||variant.tickets?.length!==max*per||variant.scope==null)return false;
    const keys=new Set();
    return variant.tickets.every(t=>{
      if(t.key!==t.trio?.join('-')||t.trio?.length!==3||new Set(t.trio).size!==3||!t.trio.every(n=>ids.has(n))||
         stats.byNo.get(t.trio[0]).line===stats.byNo.get(t.trio[1]).line||keys.has(t.key))return false;
      keys.add(t.key);return true;
    });
  })));
 }catch{return false}
}
function evaluate(shadow,parent,observed) {
 if(!validate(shadow,parent))return {status:'excluded',category:'万車シャドー記録の破損・改変'};
 const parentResult=Eval.evaluate(parent,observed);
 if(parentResult.status!=='evaluated')return {status:parentResult.status,category:parentResult.category||'結果待ち'};
 const outcomes=new Map(observed.combos.map(c=>[c.key,c.payout]));
 const byMode={};
 for(const mode of shadow.modes){
  byMode[mode.name]={};
  for(const v of mode.variants){
   const hits=v.tickets.filter(t=>outcomes.has(t.key)),payout=hits.reduce((n,t)=>n+outcomes.get(t.key),0),stake=v.tickets.length*100;
   byMode[mode.name][v.id]={stake,payout,net:payout-stake,hit:hits.length>0,hit_keys:hits.map(x=>x.key),tickets:v.tickets.length};
  }
 }
 const actual=observed.combos.map(x=>{
  const [a,b]=x.trio,stats=prep(parent.out.input);
  return {key:x.key,payout:x.payout,crossline:stats.byNo.get(a).line!==stats.byNo.get(b).line,high:x.payout>=10000};
 });
 return {status:'evaluated',actual,by_mode:byMode};
}
function summarize(rows) {
 const groups={};
 for(const row of rows)for(const [mode,variants]of Object.entries(row.evaluation.by_mode||{}))for(const [variant,ev] of Object.entries(variants)){
  const key=mode+'/'+variant,g=(groups[key]||={races:0,hits:0,high_hits:0,stake:0,payout:0,payout_top:0,tickets:0});
  g.races++;g.hits+=+ev.hit;g.stake+=ev.stake;g.payout+=ev.payout;g.tickets+=ev.tickets;g.payout_top=Math.max(g.payout_top,ev.payout);
  if(ev.hit&&row.evaluation.actual.some(x=>ev.hit_keys.includes(x.key)&&x.high))g.high_hits++;
 }
 for(const g of Object.values(groups)){g.hit_rate=g.races?g.hits/g.races:null;g.roi=g.stake?g.payout/g.stake:null;g.roi_without_max=g.stake?(g.payout-g.payout_top)/g.stake:null;g.avg_points=g.races?g.tickets/g.races:null}
 return groups;
}
module.exports={SCHEMA,VERSION,MODEL_ID,generate,validate,evaluate,summarize,pairRanks,tacticEvidence,thirdRanks};
