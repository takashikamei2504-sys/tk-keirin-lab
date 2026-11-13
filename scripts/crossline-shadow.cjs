#!/usr/bin/env node
'use strict';
/* Immutable, forward-only research. Never changes routed predictions. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Study=require('./mansha-crossline-pair-third.cjs');
const MODEL_ID='crossline-pair-2-third-2-v20261113';
const SRC='reports/mansha/crossline-pair-third-v1.json';
const read=(p,d)=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):d;
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const write=(p,x)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p+'.tmp',JSON.stringify(x)+'\n');fs.renameSync(p+'.tmp',p);};
const norm=s=>String(s||'').replace(/[\s\u3000]/g,'');
const identity=r=>r.map(x=>[x.no,String(x.meta?.rider_id||''),norm(x.name)]).sort((a,b)=>a[0]-b[0]);
const dateJST=now=>new Date(now+9*3600000).toISOString().slice(0,10);
function card(parent){
 const o=parent?.out,r=o?.input,selection=o?.selection;
 if(parent?.requested!=='auto'||selection?.requested!=='auto'||!r||parent.race_id!==[r.date,r.venue,r.race_no].join(':')||!['S級_7','S級_9','A級_7','チャレンジ_7'].includes(selection?.category?.key))return null;
 const cutoff=Date.parse(r.date+'T'+r.start+':00+09:00'),saved=Date.parse(parent.saved_at),issued=Date.parse(r.source?.generated_at);
 if(!Number.isFinite(cutoff)||!Number.isFinite(saved)||saved>=cutoff||!Number.isFinite(issued)||issued>saved||r.source?.mode!=='live-public-feed')return null;
 if(![7,9].includes(r.riders?.length)||!Array.isArray(r.lineup)||!Array.isArray(o.tickets)||o.tickets.length<1||o.tickets.length>8)return null;
 const positions=new Map();r.lineup.forEach((line,li)=>line.forEach((no,i)=>{if(!positions.has(no))positions.set(no,{line:String(li),role:i+1,lineSize:line.length});else positions.set(no,null);}));
 const e=r.riders.map(x=>({no:x.no,score:+x.score,style:x.style,...positions.get(x.no)}));
 if(positions.size!==e.length||new Set(e.map(x=>x.no)).size!==e.length||e.some(x=>!x.line||!Number.isFinite(x.score)))return null;
 const scores=e.map(x=>x.score),mean=scores.reduce((a,b)=>a+b,0)/scores.length,std=Math.sqrt(scores.reduce((a,b)=>a+(b-mean)**2,0)/scores.length);
 const ranks=new Map(e.slice().sort((a,b)=>b.score-a.score||a.no-b.no).map((x,i)=>[x.no,i]));
 for(const x of e){x.scoreZ=Math.max(-3,Math.min(3,(x.score-mean)/Math.max(std,3)));x.rankIndex=ranks.get(x.no);x.lineSize=x.lineSize||1;}
 const base=o.tickets.map(x=>x.key);if(new Set(base).size!==base.length||base.some(k=>{const parts=k.split('-').map(Number);return parts.length!==3||new Set(parts).size!==3||parts.some(n=>!ranks.has(n));}))return null;
 return {id:parent.race_id,date:r.date,venue:r.venue,race_no:r.race_no,start:r.start,cutoff:new Date(cutoff).toISOString(),saved_at:parent.saved_at,identity:identity(r.riders),source_hash:parent.output_sha256,category:selection.category.key,engine:selection.engine,base,card:{e,n:e.length,byNo:new Map(e.map(x=>[x.no,x]))}};
}
function alternatives(c,models){
 const a=Study.tickets(c.card,'regular',2,'trained2',models),b=Study.tickets(c.card,'regular',2,'all',models);
 const four=[...a.t],all=[...b.t],keep=c.base.slice(0,-2),hybrid=keep.slice();
 for(const t of four)if(hybrid.length<c.base.length&&!hybrid.includes(t))hybrid.push(t);
 for(const t of c.base)if(hybrid.length<c.base.length&&!hybrid.includes(t))hybrid.push(t);
 const swap=[...new Set(c.base.slice(0,2).map(k=>{const p=k.split('-');return [p[0],p[2],p[1]].join('-');}).filter(k=>!c.base.includes(k)))];
 return {base_8:c.base,hybrid_8:hybrid,candidates_4:four,candidates_all:all,swap_top2:swap,pairs:a.pairs.map(p=>[p.a.no,p.b.no])};
}
function freeze(parent,models,now=Date.now()){
 const c=card(parent);if(!c||now>=Date.parse(c.cutoff))return null;
 const f=alternatives(c,models);
 return {schema:'tk-crossline-shadow/v1',model:MODEL_ID,race_id:c.id,date:c.date,venue:c.venue,race_no:c.race_no,category:c.category,engine:c.engine,saved_at:new Date(now).toISOString(),cutoff:c.cutoff,source_saved_at:c.saved_at,source_hash:c.source_hash,identity:c.identity,lineup:c.card.e.map(x=>[x.no,x.line,x.role]),forecasts:f};
}
function evaluate(r,actual){
 if(!actual)return {status:'pending'};
 if(actual.accounting_hold)return {status:'excluded',reason:actual.accounting_hold};
 if(r.race_id!==actual.race_id||JSON.stringify(r.identity)!==JSON.stringify(actual.identity)||r.cutoff!==new Date(Date.parse(r.date+'T'+actual.race?.start+':00+09:00')).toISOString()||!(Date.parse(actual.source_updated_at)>Date.parse(r.cutoff))||Date.parse(actual.collected_at)<Date.parse(actual.source_updated_at))return {status:'excluded',reason:'Source and saved forecast mismatch'};
 if(!actual.combos?.length||actual.combos.some(x=>!Array.isArray(x.trio)||x.trio.length!==3||x.key!==x.trio.join('-')||!Number.isInteger(x.payout)||x.payout<=0))return {status:'pending',reason:'Payout missing'};
 const line=new Map(r.lineup.map(x=>[x[0],x[1]])),role=new Map(r.lineup.map(x=>[x[0],x[2]]));
 const topology=actual.combos.map(x=>{const [a,b,d]=x.trio,cross=line.get(a)!==line.get(b),third=line.get(d)===line.get(a)?'first':line.get(d)===line.get(b)?'second':'other';return {key:x.key,cross12:cross,three_lines:cross&&third==='other',type:(cross?'cross':'same')+'_'+third,first_role:role.get(a),second_role:role.get(b),payout:x.payout};});
 const views={};for(const [label,keys] of Object.entries(r.forecasts))if(['base_8','hybrid_8','candidates_4','candidates_all','swap_top2'].includes(label)&&Array.isArray(keys)){const set=new Set(keys),stake=keys.length*100,payout=actual.combos.filter(x=>set.has(x.key)).reduce((s,x)=>s+x.payout,0);views[label]={points:keys.length,hit:payout>0,stake,payout,net:payout-stake};}
 return {status:'evaluated',topology,views};
}
function totals(rows,name){const r=rows.filter(x=>x.evaluation.status==='evaluated'),stake=r.reduce((s,x)=>s+(x.evaluation.views[name]?.stake||0),0),payout=r.reduce((s,x)=>s+(x.evaluation.views[name]?.payout||0),0),hits=r.filter(x=>x.evaluation.views[name]?.hit).length;const largest=r.map(x=>x.evaluation.views[name]).sort((a,b)=>b.payout-a.payout)[0];return {evaluated:r.length,pending:rows.filter(x=>x.evaluation.status==='pending').length,hits,stake,payout,net:payout-stake,roi:stake?payout/stake:null,trim1_roi:largest&&stake>largest.stake?(payout-largest.payout)/(stake-largest.stake):null};}
function report(dir,outcomes,now){const rows=[],errors=[];for(const date of fs.existsSync(dir)?fs.readdirSync(dir).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)).sort():[]){const results=read(path.join(outcomes,date,'results.json'),{});for(const file of fs.readdirSync(path.join(dir,date)).filter(x=>/^[a-f0-9]{64}\.json$/.test(x)))try{const r=read(path.join(dir,date,file));if(r.model!==MODEL_ID||file!==hash(r.race_id+'|'+MODEL_ID)+'.json'||Date.parse(r.saved_at)>=Date.parse(r.cutoff))throw Error('Invalid frozen record');rows.push({...r,evaluation:evaluate(r,results[r.race_id])});}catch(e){errors.push({date,file,error:e.message});}}
 const names=['base_8','hybrid_8','candidates_4','candidates_all','swap_top2'],sum=r=>Object.fromEntries(names.map(name=>[name,totals(r,name)])),group=fn=>Object.fromEntries([...new Set(rows.map(fn))].sort().map(k=>[k,sum(rows.filter(r=>fn(r)===k))]));
 const evaluated=rows.filter(r=>r.evaluation.status==='evaluated');
 const types=[...new Set(evaluated.flatMap(r=>r.evaluation.topology.map(t=>t.type)))].sort(),byTopology=Object.fromEntries(types.map(k=>[k,sum(evaluated.filter(r=>r.evaluation.topology.length===1&&r.evaluation.topology[0].type===k))]));
 return {schema:'tk-crossline-shadow-evaluation/v1',model:MODEL_ID,generated_at:new Date(now).toISOString(),note:'Research only. No production betting changes; prospective frozen forecasts only.',totals:sum(rows),by_date:group(r=>r.date),by_category:group(r=>r.category),by_topology:byTopology,crossline:{evaluated:evaluated.length,cross12:evaluated.filter(r=>r.evaluation.topology.some(t=>t.cross12)).length,three_lines:evaluated.filter(r=>r.evaluation.topology.some(t=>t.three_lines)).length},rows,errors};
}
function run({root=path.resolve(__dirname,'..'),now=Date.now()}={}){
 const models=read(path.join(root,SRC),{}).models;if(!models?.regular?.winner?.weights||!models?.regular?.second?.weights||!models?.third?.weights)throw Error('Immutable trained weights not found');
 const history=path.join(root,'data/routed_history'),dir=path.join(root,'data/crossline_shadow'),date=dateJST(now),folder=path.join(history,date),capture={date,seen:0,new:0,existing:0,past:0,invalid:0};
 if(fs.existsSync(folder))for(const file of fs.readdirSync(folder).filter(x=>/^[a-f0-9]{64}\.json$/.test(x))){const parent=read(path.join(folder,file));capture.seen++;const c=card(parent);if(!c){capture.invalid++;continue;}const dst=path.join(dir,date,hash(c.id+'|'+MODEL_ID)+'.json');if(fs.existsSync(dst)){capture.existing++;continue;}const snap=freeze(parent,models,now);if(!snap){capture.past++;continue;}fs.mkdirSync(path.dirname(dst),{recursive:true});try{fs.writeFileSync(dst,JSON.stringify(snap)+'\n',{flag:'wx'});capture.new++;}catch(e){if(e.code==='EEXIST')capture.existing++;else throw e;}}
 const evaluation=report(dir,history,now);write(path.join(dir,'evaluation.json'),evaluation);write(path.join(dir,'status.json'),{generated_at:new Date(now).toISOString(),model:MODEL_ID,capture});console.log(JSON.stringify({capture,summary:evaluation.by_date[date]}));return evaluation;
}
if(require.main===module)run();
module.exports={MODEL_ID,card,alternatives,freeze,evaluate,totals,report,run,hash};
