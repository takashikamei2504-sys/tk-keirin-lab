/* Auditable comparison: choose and test the axis before committing the main hypothesis. */
(function(root){'use strict';
const AXES={rationality:'戦術的合理性',feasibility:'成立可能性',evidence:'実績の裏付け',interaction:'他ラインとの相互作用',robustness:'頑健性・反証'};
const keys=Object.keys(AXES),mean=(s,k)=>{const terms=s.terms.filter(t=>t.axis===k);return terms.length?terms.reduce((n,t)=>n+t.value,0)/terms.length:0;};
function family(s){return JSON.stringify([s.finish.pair,s.scenes.slice(1,5).map(x=>x.events.filter(e=>!['wait','front','finish'].includes(e.action)).map(e=>[e.actor,e.action,e.outcome])),s.detached,s.switches]);}
function select(candidates){
 const rows=candidates.map(s=>({...s,axes:Object.fromEntries(keys.map(k=>[k,mean(s,k)]))}));
 const pareto=rows.filter(a=>!rows.some(b=>b!==a&&keys.every(k=>b.axes[k]>=a.axes[k]-1e-10)&&keys.some(k=>b.axes[k]>a.axes[k]+1e-10)));
 const base=s=>keys.reduce((n,k)=>n+s.axes[k],0),ordered=[...pareto].sort((a,b)=>Math.abs(base(b)-base(a))<1e-10?a.id-b.id:base(b)-base(a)),best=base(ordered[0]);
 // Initial S-only variants must not create artificial importance.
 const families=new Map();for(const s of ordered.filter(s=>base(s)>=best-.4)){const k=family(s);if(!families.has(k))families.set(k,s);}
 const finalists=[...families.values()];
 const spreads=keys.map(axis=>{const v=finalists.map(s=>s.axes[axis]);return {axis,spread:Math.max(...v)-Math.min(...v)};}).sort((a,b)=>b.spread-a.spread||keys.indexOf(a.axis)-keys.indexOf(b.axis));
 let axis=spreads[0].axis,rated,main,rival,weights;const rounds=[],tested=new Set();
 for(let round=0;round<5;round++){
  weights=Object.fromEntries(keys.map(k=>[k,k===axis?2:1]));rated=pareto.map(s=>({...s,score:keys.reduce((sum,k)=>sum+s.axes[k]*weights[k],0)})).sort((a,b)=>Math.abs(b.score-a.score)<1e-10?a.id-b.id:b.score-a.score);
  main=rated[0];rival=rated.find(s=>family(s)!==family(main));
  const difference=rival?main.axes[axis]-rival.axes[axis]:0;
  rounds.push({axis,weights:{...weights},provisional_main:main.id,provisional_rival:rival?.id||null,axis_difference:difference});tested.add(axis);
  if(!rival||difference>1e-9)break;
  const next=keys.filter(k=>!tested.has(k)&&main.axes[k]-rival.axes[k]>1e-9).sort((a,b)=>(main.axes[b]-rival.axes[b])-(main.axes[a]-rival.axes[a]))[0];
  if(!next)break;axis=next;
 }
 const gap=rival?Math.max(0,main.score-rival.score):null,changes=rival?keys.map(k=>({axis:k,label:AXES[k],main:main.axes[k],rival:rival.axes[k],weighted_difference:(main.axes[k]-rival.axes[k])*weights[k]})).sort((a,b)=>Math.abs(b.weighted_difference)-Math.abs(a.weighted_difference)):[];
 const drivers=main.terms.filter(t=>t.axis===axis&&Math.abs(t.value)>1e-12).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value));
 const contrary=rival?.terms.filter(t=>t.axis===axis).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value))||[];
 const contrasts=rival?changes.map(c=>({...c,main_terms:main.terms.filter(t=>t.axis===c.axis),rival_terms:rival.terms.filter(t=>t.axis===c.axis)})):[];
 const difference=rival?main.axes[axis]-rival.axes[axis]:0;
 const featureNames=[...new Set([...drivers,...contrary].flatMap(t=>t.features.map(f=>`${f.no}番の${f.key}（${f.basis}）`)))];
 const selection_reason=rival?`${AXES[axis]}は本線${main.axes[axis].toFixed(3)}／対抗${rival.axes[axis].toFixed(3)}、差${difference.toFixed(3)}。${drivers.length?drivers.slice(0,2).map(t=>t.reason).join('。'):'本線に直接の裏付け加点はなく、対抗側の不利が比較差を作る。'+[...new Set(contrary.map(t=>t.reason))].slice(0,2).join('。')}`:`反証と整合性確認を通過した候補では${AXES[axis]}を確認。対抗との有意な差は確定できない。`;
 const reversal=rival?{rival:rival.id,changes,terms:contrary,condition:`${AXES[axis]}の本線優位${difference.toFixed(3)}が縮小し、他軸を含む比較差${gap.toFixed(3)}を対抗が上回る場合。${[...new Set(contrary.map(t=>t.reason))].slice(0,2).join('。')}`,features:contrary.flatMap(t=>t.features)}:null;
 const decision={axis,label:AXES[axis],reason:`有力な戦術${finalists.length}群を比較し、判断軸案を${rounds.length}回検査。本線と対抗を区別できない軸案は再検討してから本線を確定。`,spreads,weights,rounds,drivers,opposing_drivers:contrary,contrasts,gap,confidence:gap===null||gap<.2||difference<=1e-9?'拮抗':'相対的に優位',selection_reason,feature_names:featureNames,reversal};
 function explain(s){const differences=keys.map(k=>({axis:k,label:AXES[k],difference:(main.axes[k]-s.axes[k])*weights[k]})).sort((a,b)=>b.difference-a.difference),d=differences[0];return `${s.finish.mode}は${d.label}で本線に${d.difference.toFixed(3)}劣る。${s.terms.filter(t=>t.axis===d.axis).slice(-2).map(t=>t.reason).join('。')}`;}
 const alternatives=[],seen=new Set();if(rival){alternatives.push({...rival,not_selected:explain(rival)});seen.add(family(rival));}
 for(const s of rated){const k=family(s);if(s.id===main.id||seen.has(k))continue;seen.add(k);alternatives.push({...s,not_selected:explain(s)});if(alternatives.length===12)break;}
 return {main,rival,alternatives,decision,rated,pareto:pareto.length,finalists:finalists.length,mean,family};
}
const api={select,mean,family};if(typeof module!=='undefined')module.exports=api;root.LineSelection=api;
})(typeof globalThis!=='undefined'?globalThis:this);
