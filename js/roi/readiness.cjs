'use strict';
// Preregistered validation gates. These are evidence thresholds, not tuned EV filters.
const RULES = Object.freeze({training:300,holdout:200,prospective:200,days:14,binRaces:100,expectedHits:5});
const EDGES = [0,.005,.01,.02,.05,.1,.2,.4,1.000001];
function wilsonLower(hits,n) {
  if (!n) return 0;
  const z=1.96,p=hits/n,z2=z*z;
  return (p+z2/(2*n)-z*Math.sqrt(p*(1-p)/n+z2/(4*n*n)))/(1+z2/n);
}
function review(rows) {
  const byRace=new Map();
  for (const r of [...rows].sort((a,b)=>a.saved_at.localeCompare(b.saved_at))) {
    const sum=r.probabilities?.reduce((s,[,p])=>s+p,0);
    if (!r.qualified || ![7,9].includes(r.cars) || !r.winners?.length ||
        !(Date.parse(r.trained_through)<=Date.parse(r.saved_at) && Date.parse(r.saved_at)<Date.parse(r.cutoff)) ||
        r.probabilities.length!==(r.cars===7?210:504) || Math.abs(sum-1)>1e-9 ||
        new Set(r.probabilities.map(([k])=>k)).size!==r.probabilities.length ||
        r.probabilities.some(([,p])=>!Number.isFinite(p)||p<=0||p>1)) continue;
    if (!byRace.has(r.race_id)) byRace.set(r.race_id,r);
  }
  const groups={};
  for (const cars of [7,9]) {
    const subset=[...byRace.values()].filter(r=>r.cars===cars),daily=new Map();
    const bins=EDGES.slice(0,-1).map((min,i)=>({min,max:EDGES[i+1],races:0,hits:0,expected:0}));
    for (const r of subset) {
      const truth=new Set(r.winners),target=1/truth.size;
      let log=0,brier=0;
      const uniform=1/r.probabilities.length;
      for (const [key,p] of r.probabilities) {
        const y=truth.has(key)?target:0;
        if(y) log-=y*Math.log(p);
        brier+=(p-y)**2;
      }
      // Confidence uses day clusters; only one ticket per race contributes to each reliability bin.
      const day=r.cutoff.slice(0,10),g=daily.get(day)||{log:0,brier:0,n:0};
      g.log+=-Math.log(uniform)-log;g.brier+=target-uniform-brier;g.n++;daily.set(day,g);
      for (const bin of bins) {
        const pick=r.probabilities.filter(([,p])=>p>=bin.min&&p<bin.max).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0];
        if(pick){bin.races++;bin.expected+=pick[1];bin.hits+=truth.has(pick[0])?target:0;}
      }
    }
    const lower=key=>{
      const xs=[...daily.values()].map(g=>g[key]/g.n),n=xs.length;
      if(n<2)return null;
      const mean=xs.reduce((a,b)=>a+b,0)/n;
      const variance=xs.reduce((s,x)=>s+(x-mean)**2,0)/(n-1);
      return mean-2.2*Math.sqrt(variance/n);
    };
    const lossLower=lower('log'),brierLower=lower('brier');
    const factors=bins.map(b=>({...b,lower_factor:b.races>=RULES.binRaces&&b.expected>=RULES.expectedHits ?
      Math.min(1,wilsonLower(b.hits,b.races)/(b.expected/b.races)):null}));
    const qualified=subset.length>=RULES.prospective&&daily.size>=RULES.days&&lossLower>0&&brierLower>0&&factors.some(b=>b.lower_factor>0);
    groups[cars]={races:subset.length,days:daily.size,log_improvement_lower:lossLower,brier_improvement_lower:brierLower,
      qualified,bins:factors};
  }
  return {rules:RULES,groups,eligible:Object.values(groups).some(g=>g.qualified)};
}
module.exports={RULES,review,wilsonLower};