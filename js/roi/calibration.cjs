'use strict';

// Temperatures are fitted for each conditional stage independently.
// Uniform mass keeps the full 7P3 / 9P3 support, including unretained hypotheses.
const {RULES} = require('./readiness.cjs');
const GRID = [0, .25, .5, 1, 2, 4, 8];
const ratio = (x,y) => y ? x/y : null;

function design(ids, scores) {
  if (![7,9].includes(ids.length) || new Set(ids).size !== ids.length) throw Error('Invalid starters');
  const support = new Map(scores);
  const branches = new Map();
  for (const first of ids) for (const second of ids) for (const third of ids) {
    if (first === second || first === third || second === third) continue;
    const key = [first,second,third].join('-');
    const score = support.get(key) || 0;
    for (const [prefix, next] of [['',first],[String(first),second],[first+'-'+second,third]]) {
      if (!branches.has(prefix)) branches.set(prefix,new Map());
      const row = branches.get(prefix);
      row.set(next, Math.max(row.get(next) || 0, score));
    }
  }
  return branches;
}

function conditional(branches, prefix, beta) {
  const row = [...branches.get(prefix)].map(([n,v])=>[n,Math.exp(beta*v)]);
  const sum = row.reduce((a,[,v])=>a+v,0);
  return row.map(([n,v])=>[n,v/sum]);
}

function predict(branches, beta) {
  const tickets = new Map();
  for (const [a,pa] of conditional(branches,'',beta[0])) {
    for (const [b,pb] of conditional(branches,String(a),beta[1])) {
      for (const [c,pc] of conditional(branches,a+'-'+b,beta[2])) {
        tickets.set(a+'-'+b+'-'+c,pa*pb*pc);
      }
    }
  }
  return tickets;
}

function fit(rows) {
  if (!rows.length) return null;
  return [0,1,2].map(stage => {
    function loss(beta) {
      let sum = 0;
      for (const row of rows) for (const winner of row.winners) {
        const trio = winner.split('-').map(Number);
        const prob = new Map(conditional(row.branches,trio.slice(0,stage).join('-'),beta)).get(trio[stage]);
        sum -= Math.log(prob)/row.winners.length;
      }
      return sum;
    }
    return GRID.map(beta=>({beta,loss:loss(beta)})).sort((a,b)=>a.loss-b.loss || a.beta-b.beta)[0].beta;
  });
}

function assess(rows, beta) {
  const bins = [0,.005,.01,.02,.05,.1,.2,.4,1.01].map((min,i,edges)=>
    ({min,max:edges[i+1],count:0,predicted:0,observed:0})).slice(0,-1);
  let log = 0, brier = 0;
  for (const row of rows) {
    const winning = new Set(row.winners);
    for (const [key,prob] of predict(row.branches,beta)) {
      const actual = winning.has(key) ? 1/winning.size : 0;
      if (actual) log -= actual*Math.log(prob);
      brier += (prob-actual)**2;
      const bin = bins.find(x=>prob>=x.min && prob<x.max);
      bin.count++;
      bin.predicted += prob;
      bin.observed += actual;
    }
  }
  return {races:rows.length,log_loss:ratio(log,rows.length),brier:ratio(brier,rows.length),
    reliability:bins.map(b=>({...b,predicted:ratio(b.predicted,b.count),observed:ratio(b.observed,b.count)}))};
}

function train(rows, boundary) {
  const train = rows.filter(row=>row.start<boundary && row.result_at<boundary);
  const test = rows.filter(row=>row.start>=boundary);
  const beta = fit(train);
  const holdout = beta && assess(test,beta);
  const uniform = assess(test,[0,0,0]);
  // Operational evaluation is separate and must accumulate fixed prospective predictions.
  const qualified = train.length>=RULES.training && test.length>=RULES.holdout &&
    holdout.log_loss<uniform.log_loss && holdout.brier<uniform.brier;
  return {training_races:train.length,beta,holdout,uniform,eligible:false,research_qualified:qualified,
    stage:qualified ?
      'prospective_validation_required':'research_only'};
}

module.exports = {design,predict,fit,assess,train};