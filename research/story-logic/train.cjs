'use strict';
// Learns from separately authorized, structured pre-race evidence and reference labels.
// Each record: {raceId,startAt,featureAt, candidates:[{id,features:{key:value}}], favored}
function check(record, labeled=true) {
  const start=Date.parse(record.startAt), observed=Date.parse(record.featureAt);
  if(!record.raceId || !Number.isFinite(start) || !Number.isFinite(observed) || observed>=start) throw Error('invalid time gate');
  const c=record.candidates;
  if(!Array.isArray(c)||![7,9].includes(c.length)||new Set(c.map(x=>x.id)).size!==c.length) throw Error('invalid field');
  if(labeled&&!c.some(x=>x.id===record.favored)) throw Error('missing reference label');
  for(const x of c) for(const [k,v] of Object.entries(x.features||{})){
    if(!/^(role|line_length|lead_tendency|recent_form|following|sprint|position|local|tactical_flexibility|opponent_pressure|switching)$/.test(k)) throw Error('unknown feature: '+k);
    if(!['string','boolean','number'].includes(typeof v)||String(v).length>40) throw Error('bad feature');
  }
}
function fit(records,cutoff){
  const t=Date.parse(cutoff);if(!Number.isFinite(t)||!records.length)throw Error('invalid training cutoff');
  const count=[0,0], histogram={}, vocab={}, featureCount={};
  const seen=new Set();
  for(const r of records){check(r);if(Date.parse(r.startAt)>=t||seen.has(r.raceId))throw Error('training overlap');seen.add(r.raceId);
    for(const c of r.candidates){const y=Number(c.id===r.favored);count[y]++;
      for(const [k,v] of Object.entries(c.features||{})){const s=String(v);(vocab[k]??=new Set()).add(s);const key=JSON.stringify([k,s]);(histogram[key]??=[0,0])[y]++;(featureCount[k]??=[0,0])[y]++;}
    }
  }
  return {cutoff,records:records.length,count,histogram,featureCount,vocab:Object.fromEntries(Object.entries(vocab).map(([k,v])=>[k,v.size]))};
}
function predict(model,r){check(r,false);if(Date.parse(r.startAt)<Date.parse(model.cutoff))throw Error('in-sample prediction prohibited');
  const scores=r.candidates.map(c=>{let score=Math.log((model.count[1]+1)/(model.count[0]+1));
    for(const [k,v] of Object.entries(c.features||{})){if(!model.vocab[k])continue;const h=model.histogram[JSON.stringify([k,String(v)])]||[0,0];const n=model.featureCount[k], V=model.vocab[k]+1;score+=Math.log((h[1]+1)/(n[1]+V))-Math.log((h[0]+1)/(n[0]+V));}
    return {id:c.id,score};});
  const max=Math.max(...scores.map(x=>x.score));const denom=scores.reduce((s,x)=>s+Math.exp(x.score-max),0);
  return scores.map(x=>({id:x.id,probability:Math.exp(x.score-max)/denom})).sort((a,b)=>b.probability-a.probability||a.id-b.id);
}
function evaluate(model,records){const seen=new Set();let exact=0,top3=0,loss=0;for(const r of records){check(r);if(seen.has(r.raceId))throw Error('duplicate test');seen.add(r.raceId);const p=predict(model,r);exact+=Number(p[0].id===r.favored);top3+=Number(p.slice(0,3).some(x=>x.id===r.favored));loss-=Math.log(p.find(x=>x.id===r.favored).probability);}return {n:records.length,top1:records.length?exact/records.length:null,top3:records.length?top3/records.length:null,logLoss:records.length?loss/records.length:null};}
module.exports={fit,predict,evaluate};
