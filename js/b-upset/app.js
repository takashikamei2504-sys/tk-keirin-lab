(function(){
  'use strict';
  const root='https://raw.githubusercontent.com/takashikamei2504-sys/tk-keirin-lab/main/data/b_upset/';
  const $=id=>document.getElementById(id);
  const pct=n=>n===null||n===undefined?'—':(n*100).toFixed(1)+'%';
  const yen=n=>Number(n||0).toLocaleString('ja-JP')+'円';
  const names={ad:'A〜D限定',expanded:'A〜H拡張',all_candidates:'全候補購入（研究）',third_all:'3着総流し（研究）',normal:'FラインBの通常展開',roi_ev:'期待値選別',LAB:'保存LAB',LINE:'保存LAB LINE',AD:'A〜D限定',AH:'A〜H拡張',EV:'期待値選別'};
  const patterns={A:'B-B-B',B:'B-F-B',C:'B-B-F',D:'F-B-B',E:'B-F-F',F:'F-B-F',G:'F-F-B',H:'X混入',Z:'B不残存'};
  let data,record,current,revision=0;
  function node(tag,text,cls){const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;}
  function table(target,headers,rows){
    const table=document.createElement('table'),head=document.createElement('tr');
    headers.forEach(h=>head.append(node('th',h)));table.append(head);
    rows.forEach(row=>{const tr=document.createElement('tr');row.forEach(v=>tr.append(node('td',v)));table.append(tr);});
    $(target).replaceChildren(table);
  }
  function stats(target,bins){
    table(target,['方式','対象','的中','点数平均','回収率','収支','最大DD','最大1件除外','上位5件除外'],Object.entries(bins).map(([k,s])=>[
      names[k]||k,s.n,s.hits,s.avg_points?.toFixed(1)||'0',pct(s.roi),yen(s.net),yen(s.max_drawdown),pct(s.trim1),pct(s.trim5)]));
  }
  async function json(file){
    const res=await fetch(root+file+'?v='+Date.now(),{cache:'no-store'});
    if(!res.ok)throw Error('HTTP '+res.status);return res.json();
  }
  function matching(){return data.rows.filter(r=>r.date===$('date').value);}
  function venues(){
    const vs=[...new Set(matching().map(r=>r.venue))].sort((a,b)=>a.localeCompare(b,'ja'));
    $('venue').replaceChildren(...vs.map(v=>new Option(v,v)));races();
    $('today').replaceChildren(...matching().slice().sort((a,b)=>a.start.localeCompare(b.start)).map(r=>{
      const button=node('button',r.venue+' '+r.race_no+'R '+r.start+' ／ '+r.ranking.lines.find(l=>l.id===r.ranking.favorite).members.join('-')+'をFに評価','race-link');
      button.type='button';button.addEventListener('click',()=>{$('venue').value=r.venue;races(r.race_id);});return button;
    }));
    $('count').textContent=matching().length+'レースの発走前予想を保存';
  }
  function races(id){
    const rs=matching().filter(r=>r.venue===$('venue').value).sort((a,b)=>a.race_no-b.race_no);
    $('race').replaceChildren(...rs.map(r=>new Option(r.race_no+'R',r.race_id)));
    if(id&&rs.some(r=>r.race_id===id))$('race').value=id;
    loadRace();
  }
  async function loadRace(){
    const token=++revision;
    $('detail').hidden=true;
    current=data.rows.find(r=>r.race_id===$('race').value);
    if(!current)return;
    try{
      const stored=await json(current.record);if(token!==revision)return;
      record=stored.out;
      $('race-name').textContent=record.race.venue+' '+record.race.race_no+'R '+record.race.start;
      const f=record.ranking.lines.find(l=>l.id===record.ranking.favorite);
      $('favorite').textContent='Fライン '+f.members.join('-')+' ／ 力量順位1位';
      $('rank-source').textContent='独立した発走前得点評価。市場人気順位は未取得。'+record.ranking.formula;
      $('decision').textContent=record.recommendation.status==='skip'?'購入は見送り。'+record.recommendation.reason:'購入候補 '+record.recommendation.tickets.length+'点';
      $('saved').textContent='保存 '+new Date(stored.saved_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+' ／ '+record.model.model_id;
      const lines=record.ranking.lines.filter(l=>record.scenarios.some(s=>s.b_line===l.id));
      $('back').replaceChildren(new Option('すべてのB候補',''),...lines.map(l=>new Option(l.members.join('-')+' ／ 力量'+l.strength_rank+'位',l.id)));
      renderDetails();$('detail').hidden=false;
    }catch(e){if(token===revision)$('health').textContent='保存予想を取得できません：'+e.message;}
  }
  function renderDetails(){
    const back=$('back').value,show=s=>!back||s.b_line===back;
    $('scenarios').replaceChildren(...record.scenarios.filter(show).map(s=>{
      const d=node('details','','scenario');d.append(node('summary','B候補 '+s.b_members.join('-')+' ／ '+s.tactic_label+' ／ '+s.assessment));
      d.append(node('p','B先頭は'+s.b_no+'番。成立支持 '+s.b_support.toFixed(2)+'（相対スコア）'));
      d.append(node('p',s.reasons.join('。')));d.append(node('p','反証：'+s.counter_evidence.join('。')));
      d.append(node('p','EXの採用観測 '+s.ex_used.length+'件 ／ 追走離れ想定 '+s.detachment.map(x=>x.no).join('・')+' ／ 番手争い想定 '+s.contests.map(x=>x.no).join('・')));
      s.phases.forEach(p=>{const e=node('div','','phase');e.append(node('strong',p.label),node('p',p.order.join(' → ')),node('p',p.events.map(e=>e.reason).join('。')));d.append(e);});return d;
    }));
    const choice=$('view').value;
    const ts=(choice==='purchase'?record.recommendation.tickets:record.research[choice]).filter(t=>!back||t.b_line===back);
    $('points').textContent=ts.length+'点 ／ '+(choice==='purchase'?'推奨購入額 '+yen(ts.reduce((s,t)=>s+t.amount,0)):'仮説の研究候補。表示支持スコアは確率ではありません。');
    $('tickets').replaceChildren(...ts.map(t=>{
      const d=node('article','','ticket');d.append(node('p',(t.subtype||t.pattern)+'｜'+patterns[t.pattern]+' ／ B '+record.ranking.lines.find(l=>l.id===t.b_line).members.join('-')),node('strong',t.key),node('p',t.reason||t.finish_mode));
      d.append(node('p','実オッズ '+(t.odds??'—')+' ／ 校正確率 '+pct(t.probability)+' ／ 期待値 '+(t.ev?.toFixed(2)??'—')+' ／ 推奨 '+yen(t.amount)));
      if(t.finish_phases){const detail=document.createElement('details');detail.append(node('summary','4角からの決着根拠'));t.finish_phases.forEach(p=>detail.append(node('p',p.label+' '+p.order.join(' → ')+'。'+p.events.map(e=>e.reason).join('。'))));d.append(detail);}return d;
    }));
    const ev=current.evaluation,actual=ev.actual_b;
    $('race-result').replaceChildren(node('p',ev.status==='evaluated'?'三連単照合済み ／ A〜D '+(ev.views.ad.hit?'的中':'不的中')+' ／ A〜H '+(ev.views.expanded.hit?'的中':'不的中'):'照合状態 '+ev.status));
    $('race-result').append(node('p',actual?'実B '+actual.no+'番 ／ '+actual.line_id+' ／ 第1B候補 '+(actual.primary_correct?'的中':'不的中')+' ／ B候補ライン集合 '+(actual.candidate_line_hit?'含む':'含まない'):'実B取得記録は未取得。B予測の的中は集計待ち。'));
    if(actual){const a=node('a','B取得記録の出典');a.href=actual.source_url;$('race-result').append(a);}
  }
  json('evaluation.json').then(d=>{
    data=d;const s=d.summary;
    $('health').textContent='最終集計 '+new Date(d.generated_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
    $('coverage').textContent='保存 '+s.saved+'R ／ 照合 '+s.evaluated+'R ／ 結果待ち '+s.pending+'R ／ 実B確認 '+s.actual_b_known+'R ／ 第1B候補的中 '+s.b_correct+'R';
    stats('summary',s.views);stats('patterns',s.patterns);
    stats('cars',Object.fromEntries(Object.entries(d.by_cars).map(([n,s])=>[n+'車 A〜H',s.views.expanded])));
    stats('models',Object.fromEntries(Object.entries(d.by_model).map(([n,s])=>[n,s.views.expanded])));
    const days=[...new Set(d.rows.map(r=>r.date))].sort().reverse(),today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
    $('date').replaceChildren(...days.map(d=>new Option(d,d)));$('date').value=days.includes(today)?today:days[0]||'';venues();
  }).catch(e=>{$('health').textContent='発走前予想の初回保存を待っています。'+e.message;});
  json('research.json').then(r=>{
    const s=r.scope;
    $('research-state').textContent=s.start+'〜'+s.end+' ／ 取得 '+s.available_days+'/'+s.requested_days+'日 ／ 有効出走表 '+s.eligible_cards+'R ／ 展開再現 '+s.simulation_sample+'R。'+s.sampling+'。新エンジンの発走前実績は上段で別集計します。';
    stats('research',r.overall.views);
    stats('periods',Object.fromEntries(Object.entries(r.by_period).flatMap(([p,s])=>['ad','expanded'].map(k=>[p+' '+names[k],s.views[k]]))));
    $('b-coverage').textContent='実B確認 '+s.actual_b_known+'R ／ 非FラインBの決着 '+s.actual_nonfavorite_b_finishes+'件。以下は実B取得後の記述集計です。';
    table('b-patterns',['型','件数','割合','平均配当','中央値','50〜100倍','100倍以上'],Object.entries(r.actual_b.patterns).map(([k,v])=>[k,v.n,pct(v.rate),yen(v.average.toFixed(0)),yen(v.median),v.mid50to100,v.over100]));
    $('common-count').textContent='同一レースの保存LAB・LINEが揃う比較 '+r.common_frozen_sources.n+'R。LAB・LINEは既存の保存点数、B-UPSETは最大10点です。';
    stats('common',Object.fromEntries(Object.entries(r.common_frozen_sources).filter(([k])=>k!=='n')));
  }).catch(e=>{$('research-state').textContent='過去データの検証を実行中です。'+e.message;});
  $('date').addEventListener('change',venues);$('venue').addEventListener('change',()=>races());$('race').addEventListener('change',loadRace);
  $('back').addEventListener('change',renderDetails);$('view').addEventListener('change',renderDetails);
})();
