/* Cross-line 4/6/8/10 point forward-only research shadow. Never changes purchase eligibility. */
(function(root){'use strict';
const Cross=typeof module!=='undefined'?require('./selected.js'):root.CrosslineSelected;
const VERSION='crossline-expanded-shadow-v1-20261119',COUNTS=[4,6,8,10];
const dot=(x,w)=>x.reduce((s,v,i)=>s+v*w[i],0);
const softmax=a=>{const max=Math.max(...a),v=a.map(x=>Math.exp(x-max)),s=v.reduce((x,y)=>x+y,0);return v.map(x=>x/s);};
function predict(race,models){
 if(!Cross.validWeights(models))throw Error('Frozen legacy model weights required');
 const c=Cross.card(race),win=softmax(c.e.map(x=>dot(Cross.features(x,c),models.regular.winner.weights)));
 const second=softmax(c.e.map(x=>dot(Cross.features(x,c),models.regular.second.weights)));
 const pairs=[];
 for(let i=0;i<c.e.length;i++)for(let j=0;j<c.e.length;j++){
  const a=c.e[i],b=c.e[j];
  if(i!==j&&a.line!==b.line)pairs.push({a,b,score:Math.log(win[i])+Math.log(second[j])});
 }
 pairs.sort((x,y)=>y.score-x.score||x.a.no-y.a.no||x.b.no-y.b.no);
 const variants={},orderedPairs=[];
 for(const count of COUNTS){
  const n=count/2;
  const tickets=[];
  for(const p of pairs.slice(0,n)){
   const thirds=c.e.filter(x=>x.no!==p.a.no&&x.no!==p.b.no)
    .sort((x,y)=>dot(Cross.features(y,c,p.a,p.b),models.third.weights)-
       dot(Cross.features(x,c,p.a,p.b),models.third.weights)||x.no-y.no);
   tickets.push([p.a.no,p.b.no,thirds[0].no].join('-'),[p.a.no,p.b.no,thirds[1].no].join('-'));
  }
  if(tickets.length!==count||new Set(tickets).size!==count)throw Error('Invalid expanded selection');
  variants[String(count)]=tickets;
 }
 const original=Cross.pairsAndTickets(c,models);
 if(JSON.stringify(variants['4'])!==JSON.stringify(original.candidate4))throw Error('Legacy 4-point ranking mismatch');
 for(const p of pairs.slice(0,5))orderedPairs.push([p.a.no,p.b.no]);
 for(let i=1;i<COUNTS.length;i++)if(JSON.stringify(variants[String(COUNTS[i])].slice(0,COUNTS[i-1]))!==JSON.stringify(variants[String(COUNTS[i-1])]))throw Error('Ranking is not nested');
 return {version:VERSION,ordered_pairs:orderedPairs,variants};
}
const api={VERSION,COUNTS,predict};
if(typeof module!=='undefined')module.exports=api;
root.CrosslineExpanded=api;
})(typeof globalThis!=='undefined'?globalThis:this);
