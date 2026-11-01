/* Presentation only: each chosen ticket points to its actual supporting causal path. */
(function(root){'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function group(tickets){
 const map=new Map();
 for(const t of tickets){const p=t.supporting_path;if(!p)throw Error('買い目の対応展開がありません');
  const context=[p.mode,p.front,p.attacker,p.stand,p.tactic,p.outcome,p.gap,p.first].join('|');
  if(!map.has(context))map.set(context,{id:map.size+1,path:p,tickets:[]});map.get(context).tickets.push(t);
 }return [...map.values()];
}
function render(out,race){
 const $=id=>document.getElementById(id),labels=root.RaceBrain.MODES,all=group(out.chosen),featured=[];
 for(const g of all)if(featured.length<3&&!featured.some(f=>f.path.mode===g.path.mode))featured.push(g);
 for(const g of all)if(featured.length<3&&!featured.includes(g))featured.push(g);
 const groups=[...featured,...all.filter(g=>!featured.includes(g))],ticketGroup=new Map();groups.forEach((g,i)=>g.id=i+1);
 const names=new Map(race.riders.map(r=>[r.no,r.name])),who=n=>n+'番'+(names.get(n)||'');
 groups.forEach(g=>g.tickets.forEach(t=>ticketGroup.set(t.key,g.id)));
 const story=g=>{const n=g.path;return `<article class="scenario-card" id="scenario-${g.id}"><div class="scenario-heading"><h3>展開${g.id} <span>${esc(labels[n.mode])}</span></h3><span class="scenario-count">${g.tickets.length}点</span></div><p class="scenario-summary">${esc(who(n.front))}が${n.stand==='resist'?'突っ張り':'引き'}、${esc(who(n.attacker))}が${n.tactic==='kamashi'?'カマシ':'捲り'}。${esc(who(n.leader))}が主導権を取る想定。${esc(n.snapshots[3].action)}。</p><div class="scenario-bets" aria-label="展開${g.id}の買い目">${g.tickets.map(t=>`<span>${esc(t.key)}</span>`).join('')}</div><details class="scenario-path"><summary>隊列と判断根拠（${esc(g.tickets[0].key)}の例）</summary><ol>${n.states.map(s=>`<li>${esc(s)}</li>`).join('')}</ol><details class="decision-reasons"><summary>選手ごとの判断根拠</summary>${n.decisions.map(d=>`<p class="small"><strong>${d.no}番 ${esc(d.name)}</strong>：${esc(d.context)}<br>${esc(d.basis)}${d.measurements.length?'<br>'+esc(d.measurements.join(' ／ ')):''}</p>`).join('')}</details></details></article>`;};
 $('prediction-race').textContent=`${out.race.date} ${out.race.venue}${out.race.race_no}R ｜ ${race.riders.length}車・${out.race.start}発走`;
 $('prediction-context').textContent=`想定並び ${race.lineup.map(l=>l.join('-')).join(' / ')}${race.source?.label?' ／ '+race.source.label:' ／ 参考サンプル'}`;
 $('causal-stories').innerHTML=groups.slice(0,3).map(story).join('')+(groups.length>3?`<details class="more-scenarios" id="more-scenarios"><summary>ほかの展開と買い目（${groups.length-3}案・${groups.slice(3).reduce((sum,g)=>sum+g.tickets.length,0)}点）</summary>${groups.slice(3).map(story).join('')}</details>`:'');
 $('causal-tickets').innerHTML=out.chosen.map((t,i)=>`<div class="causal-ticket"><div class="ticket-title"><span class="ticket-number">${i+1}</span><strong>${esc(t.key)}</strong><a href="#scenario-${ticketGroup.get(t.key)}" data-scenario="${ticketGroup.get(t.key)}">展開${ticketGroup.get(t.key)}</a></div><details class="ticket-reason"><summary>採用理由</summary><p class="small">${esc(t.selection_reason)}</p><p class="small">${esc(t.supporting_path.explanation)}</p><p class="small">未校正の仮説スコアから選定。</p></details></div>`).join('');
 $('prediction-feedback').textContent='';
}
if(typeof document!=='undefined')document.addEventListener('click',e=>{const a=e.target.closest?.('[data-scenario]');if(!a)return;const card=document.getElementById('scenario-'+a.dataset.scenario);if(!card)return;e.preventDefault();for(let p=card.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;card.scrollIntoView({block:'start',behavior:'smooth'});const h=card.querySelector('h3');h.tabIndex=-1;h.focus({preventScroll:true});});
const api={group,render};if(typeof module!=='undefined')module.exports=api;root.PredictionView=api;
})(typeof globalThis!=='undefined'?globalThis:this);
