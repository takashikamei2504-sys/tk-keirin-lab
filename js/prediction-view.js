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
function copyLegacy(out){return `${out.race.date} ${out.race.venue}${out.race.race_no}R ３連単${out.chosen.length}点\n`+compact(out.chosen).map(r=>`${r.label}（${r.count}点）`).join('\n');}
function renderLegacy(out,race){
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
function copyText(out){
 if(!out.story)return copyLegacy(out);
 return `${out.race.date} ${out.race.venue}${out.race.race_no}R ３連単${out.chosen.length}点\n【本線6点】\n`+compact(out.chosen.filter(t=>t.group==='main')).map(r=>`${r.label}（${r.count}点）`).join('\n')+'\n【別筋4点】\n'+out.chosen.filter(t=>t.group==='alternative').map((t,i)=>`${i+1}. ${t.key}（${out.story.alternatives[i].divergence}）`).join('\n');
}
function render(out,race){
 if(!out.story)return renderLegacy(out,race);
 const $=id=>document.getElementById(id),main=out.story.main,alternatives=out.story.alternatives;
 const reactionLedger=x=>{
  const ledger=x.lineReactions;
  if(!ledger?.rows?.length)return '';
  return '<details class="line-reactions-detail"><summary>この局面の全ラインの反応</summary>'+
   ledger.rows.map(row=>{
    const changes=(ledger.riders||[]).filter(r=>r.lineHead===row.leader&&r.from!==r.to);
    return '<p class="small"><strong>'+esc(row.line.join('－'))+'（'+esc(row.action)+'）</strong>：'+esc(row.cause)+
     (row.changed?'。ライン先頭は'+row.from+'番手→'+row.to+'番手':'')+
     (changes.length?'<span> ／ '+changes.map(r=>esc(r.no+'番'+r.name+' '+r.from+'→'+r.to+'番手')).join('、')+'</span>':'')+'</p>';
   }).join('')+'</details>';
 };
 const reasoning=x=>{const a=x.reasoning;if(!a)return '';return `<details class="stage-reasoning"><summary>この判断の材料・別の選択肢</summary>${a.facts.length?'<p class="small"><strong>入力・公開資料の材料</strong></p><ul>'+a.facts.slice(0,5).map(f=>`<li>${esc(f.label)}${f.source?.url?` <a href="${esc(f.source.url)}" target="_blank" rel="noopener noreferrer">出典</a>`:''}</li>`).join('')+'</ul>':''}${a.inferences.length?'<p class="small"><strong>この筋で置いた判断</strong></p><ul>'+a.inferences.slice(0,5).map(t=>`<li>${esc(t)}</li>`).join('')+'</ul>':''}${a.scrutiny?.length?'<details class="waiting-checks"><summary>仕掛けと待機を問い直した記録</summary>'+a.scrutiny.map(d=>'<p><strong>'+esc(d.phase)+'</strong>：'+esc(d.selected_reason)+'</p>'+d.riders.map(x=>'<p class="small"><strong>'+x.no+'番</strong>：'+esc(x.no===d.actor?x.attack_reasons.join('。'):d.waiting.find(w=>w.no===x.no)?.reason||x.wait_reasons.join('。'))+'</p>').join('')+d.reply.map(x=>'<p class="small">反撃の検討：'+esc(x.reason)+'</p>').join('')).join('')+'</details>':''}${a.decisions.filter(d=>d.alternatives?.length).map(d=>`<div class="decision-comparison"><p><strong>${esc(d.reasoning.label)}</strong></p>${d.alternatives.slice(0,2).map(o=>`<p class="small">別の選択：${esc(o.label)}${o.feasibility==='blocked'?'（進路条件で除外）':''}<br>${esc(o.basis)}</p>`).join('')}</div>`).join('')}${a.missing.length?'<p class="small">未確認：'+a.missing.slice(0,2).map(esc).join('。')+'。</p>':''}<p class="small">選択肢の重み付けに実際に使った材料です。位置・消耗と判断係数は未校正の仮説です。</p>${strategy({decisions:a.decisions})}${reactionLedger(x)}</details>`;};
 const diagrams=root.FormationDiagram||(typeof module!=='undefined'?require('./formation-diagram.js'):null);
 const strategy=s=>s.decisions.filter(d=>d.strategic).map(d=>`<details class="decision-reasons"><summary>赤板の全ライン駆け引きを比較</summary><p class="small">${esc(d.strategic.selected_reason)}</p>${d.strategic.comparisons.map(x=>`<p class="small">${esc(x.key==='wait'?'待機':x.actor+'番 '+(x.tactic==='kamashi'?'カマシ':'抑え'))}：${esc(x.opponent||'')}${x.rival?' ／ 別線の仕掛け '+x.rival+'番':''}</p>`).join('')}</details>`).join('');
 const stages=s=>s.scenes.map((x,i)=>`<section class="story-stage" data-stage="${x.stage}"><h4>${x.stage}. ${esc(x.stage===6?'最後の直線・ゴール':x.phase)}</h4>${diagrams?diagrams.render(diagrams.project(x,race,s.scenes[i-1]),{storyId:s.id}):''}<p class="story-prose">${esc(x.action)}</p>${reasoning(x)}</section>`).join('');
 const sourceLines=out.context.lines.filter(l=>l.facts.length).map(l=>`<p>${l.facts.map(esc).join('。')}。<br>${esc(l.inference)}</p>`).join('');
 $('prediction-race').textContent=`${out.race.date} ${out.race.venue}${out.race.race_no}R ｜ ${race.riders.length}車・${out.race.start}発走`;
 $('prediction-context').textContent=`想定並び ${race.lineup.map(l=>l.join('-')).join(' / ')}`;
 $('causal-stories').innerHTML=`<article class="scenario-card main-story" id="scenario-1"><h3>本線の展開予想</h3><p class="story-lead">${esc(main.reading||main.title)}</p>${stages(main)}<details class="decision-reasons"><summary>参考資料・検証メモ</summary><p class="small">${esc(out.context.lineup_status)}</p>${sourceLines||'<p>連係上の特別な動機は確認できていません。</p>'}${out.context.relationships.map(e=>`<p class="small"><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.title||'本文の関係発言')}</a>：${esc(e.excerpt)}</p>`).join('')}<p class="small">${out.context.missing.map(esc).join('。')}。位置・車間・速度・消耗は未計測の仮説です。</p><p class="small diagram-limits">モデル図は前後関係の模式図です。同じ英字・線色は元のライン。枠の大きさや間隔は車間・速度を表しません。外・内の表示はエンジンがその動きを明示した選手だけです。一本棒は左が先頭、右が後方です。攻防図では、外の仕掛けを対抗する先頭・番手と同じ列に寄せて最大3段で示します。外①・外②は別の仕掛けの区別で、厳密な外内の順序や並びかけた車輪位置は表しません。ブロックで止まった選手は前進させません。外の仕掛けは、元のラインで隊列が連続し連結が切れていない選手を同行として表示し、以降も追走離れ・別行動がなければ同じ段を保ちます。車番に対応する選手名を図の下に併記します。姓の区切りが分からない選手はフルネームで表示します。</p></details></article><details class="more-scenarios" id="more-scenarios"><summary>判断が変わる4つの別筋（穴候補を含む）</summary>${alternatives.map((s,i)=>`<article class="scenario-card alternative-story" id="scenario-${i+2}"><h3>別筋${i+1}：${esc(s.divergence)}</h3><p>${esc(s.trigger)}。</p><p>${esc(s.scenes[5].action)}</p><div class="scenario-bets"><span>${esc(out.chosen[6+i].key)}</span>${s.upset?'<small>本線と1着が変わる穴候補（オッズ未確認）</small>':''}</div><details class="scenario-path"><summary>この別筋の6段階を見る</summary>${stages(s)}</details></article>`).join('')}</details>`;
 const row=(tickets,scenario)=>compact(tickets).map(r=>`<div class="causal-ticket" data-count="${r.count}" data-ticket-keys="${esc(JSON.stringify(r.tickets.map(t=>t.key)))}"><div class="ticket-title"><strong>${esc(r.label)}</strong><span>${r.count}点</span></div><details class="ticket-reason"><summary>対応する展開</summary>${r.tickets.map(t=>`<p><strong>${esc(t.key)}</strong> <a href="#scenario-${scenario(t)}" data-scenario="${scenario(t)}">${t.group==='main'?'本線のストーリー':'別筋のストーリー'}へ</a><br>${esc(t.selection_reason)}</p>`).join('')}<p class="small">対応するストーリー内の決着候補から選んだ買い目です。</p></details></div>`).join('');
 $('causal-tickets').innerHTML='<h4 class="bet-group-title">本線6点</h4>'+row(out.chosen.filter(t=>t.group==='main'),()=>1)+'<h4 class="bet-group-title">別筋4点（各展開から1点）</h4>'+row(out.chosen.filter(t=>t.group==='alternative'),t=>2+out.chosen.filter(x=>x.group==='alternative').findIndex(x=>x.key===t.key));
 $('ticket-display-count').textContent='本線6点 ＋ 別筋4点 ＝ 合計10点。同じ1・2着はまとめて表示。';
 $('prediction-feedback').textContent='';$('causal-copy').textContent='10点をコピー';
 $('causal-state').textContent+=` 本線は買い目の順位付けより先に選択。探索${out.diagnostics.terminalStates}経路、未解決の重み${(out.diagnostics.unresolvedMass*100).toFixed(1)}%（確率ではない）。`;
}
if(typeof document!=='undefined')document.addEventListener('click',e=>{const a=e.target.closest?.('[data-scenario]');if(!a)return;const card=document.getElementById('scenario-'+a.dataset.scenario);if(!card)return;e.preventDefault();for(let p=card.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;card.scrollIntoView({block:'start',behavior:'smooth'});const h=card.querySelector('h3');h.tabIndex=-1;h.focus({preventScroll:true});});
const api={group,compact,copyText,render};if(typeof module!=='undefined')module.exports=api;root.PredictionView=api;
})(typeof globalThis!=='undefined'?globalThis:this);
