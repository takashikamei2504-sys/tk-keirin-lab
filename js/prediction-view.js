/* Presentation only: each chosen ticket points to its actual supporting causal path. */
(function(root){'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function group(tickets){
 const map=new Map();
 for(const t of tickets){const p=t.supporting_path;if(!p)throw Error('買い目の対応展開がありません');
  const context=[p.mode,p.front,p.attacker,p.stand,p.tactic,p.outcome,p.gap,p.first,p.pathId].join('|');
  if(!map.has(context))map.set(context,{id:map.size+1,path:p,tickets:[]});map.get(context).tickets.push(t);
 }return [...map.values()];
}
function compact(tickets){
 const rows=new Map(),seen=new Set();
 for(const t of tickets){
  const trio=t.trio||String(t.key).split('-').map(Number);
  if(trio.length!==3||new Set(trio).size!==3||!trio.every(n=>Number.isInteger(n)&&n>=1&&n<=9))throw Error('買い目の車番が不正です');
  const key=trio.join('-');if(seen.has(key))continue;seen.add(key);
  const pair=trio.slice(0,2).join('-');if(!rows.has(pair))rows.set(pair,{pair,tickets:[]});rows.get(pair).tickets.push({...t,key,trio});
 }
 return [...rows.values()].map(row=>{const tickets=row.tickets.slice().sort((a,b)=>a.trio[2]-b.trio[2]);return {...row,tickets,count:tickets.length,label:row.pair+'-'+tickets.map(t=>t.trio[2]).join('')};});
}
function copyText(out){return `${out.race.date} ${out.race.venue}${out.race.race_no}R ３連単${out.chosen.length}点\n`+compact(out.chosen).map(r=>`${r.label}（${r.count}点）`).join('\n');}
function render(out,race){
 const $=id=>document.getElementById(id),labels=root.RaceBrain.MODES,all=group(out.chosen),featured=[];
 for(const g of all)if(featured.length<3&&!featured.some(f=>f.path.mode===g.path.mode))featured.push(g);
 for(const g of all)if(featured.length<3&&!featured.includes(g))featured.push(g);
 const groups=[...featured,...all.filter(g=>!featured.includes(g))],ticketGroup=new Map();groups.forEach((g,i)=>g.id=i+1);
 const names=new Map(race.riders.map(r=>[r.no,r.name])),who=n=>n+'番'+(names.get(n)||'');
 groups.forEach(g=>g.tickets.forEach(t=>ticketGroup.set(t.key,g.id)));
 const story=g=>{const n=g.path;return `<article class="scenario-card" id="scenario-${g.id}"><div class="scenario-heading"><h3>展開${g.id} <span>${esc(labels[n.mode])}</span></h3><span class="scenario-count">${g.tickets.length}点</span></div><p class="scenario-summary">${esc(n.explanation)}。</p><div class="scenario-bets" aria-label="展開${g.id}の買い目">${compact(g.tickets).map(r=>`<span>${esc(r.label)}</span>`).join('')}</div><details class="scenario-path"><summary>隊列と判断根拠（${esc(g.tickets[0].key)}の例）</summary><ol>${n.states.map(s=>`<li>${esc(s)}</li>`).join('')}</ol>${n.feasibilityReasons?'<p class="small">'+esc(n.feasibilityReasons.join(' ／ '))+'。位置移動・消耗は未校正の仮説です。</p>':''}<details class="decision-reasons"><summary>選手ごとの判断根拠</summary>${n.decisions.map(d=>`<p class="small"><strong>${d.no}番 ${esc(d.name)}</strong>：${esc(d.context)}<br>${esc(d.basis)}${d.measurements.length?'<br>'+esc(d.measurements.join(' ／ ')):''}</p>`).join('')}</details></details></article>`;};
 $('prediction-race').textContent=`${out.race.date} ${out.race.venue}${out.race.race_no}R ｜ ${race.riders.length}車・${out.race.start}発走`;
 $('prediction-context').textContent=`想定並び ${race.lineup.map(l=>l.join('-')).join(' / ')}${race.source?.label?' ／ '+race.source.label:' ／ 参考サンプル'}`;
 $('causal-stories').innerHTML=groups.slice(0,3).map(story).join('')+(groups.length>3?`<details class="more-scenarios" id="more-scenarios"><summary>ほかの展開と買い目（${groups.length-3}案・${groups.slice(3).reduce((sum,g)=>sum+g.tickets.length,0)}点）</summary>${groups.slice(3).map(story).join('')}</details>`:'');
 const rows=compact(out.chosen);
 $('ticket-display-count').textContent=`${rows.length}行にまとめて表示・合計${rows.reduce((sum,r)=>sum+r.count,0)}点`;
 $('causal-tickets').innerHTML=rows.map(row=>`<div class="causal-ticket" data-count="${row.count}" data-ticket-keys="${esc(JSON.stringify(row.tickets.map(t=>t.key)))}"><div class="ticket-title"><strong>${esc(row.label)}</strong><span class="ticket-count">${row.count}点</span></div><details class="ticket-reason"><summary>展開・採用理由</summary>${row.tickets.map(t=>`<div class="compact-ticket-source"><p class="small"><strong>${esc(t.key)}</strong> <a href="#scenario-${ticketGroup.get(t.key)}" data-scenario="${ticketGroup.get(t.key)}">展開${ticketGroup.get(t.key)}へ</a><br>${esc(t.selection_reason)}</p><p class="small">${esc(t.supporting_path.explanation)}</p></div>`).join('')}<p class="small">未校正の仮説スコアから選定。</p></details></div>`).join('');
 $('prediction-feedback').textContent='';
 if(out.diagnostics)$('causal-state').textContent+=` 逐次判断 ${out.diagnostics.terminalStates}経路。探索打切りによる未解決の重み ${(out.diagnostics.unresolvedMass*100).toFixed(1)}%（的中確率ではない）。`;
}
if(typeof document!=='undefined')document.addEventListener('click',e=>{const a=e.target.closest?.('[data-scenario]');if(!a)return;const card=document.getElementById('scenario-'+a.dataset.scenario);if(!card)return;e.preventDefault();for(let p=card.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;card.scrollIntoView({block:'start',behavior:'smooth'});const h=card.querySelector('h3');h.tabIndex=-1;h.focus({preventScroll:true});});
const api={group,compact,copyText,render};if(typeof module!=='undefined')module.exports=api;root.PredictionView=api;
})(typeof globalThis!=='undefined'?globalThis:this);
