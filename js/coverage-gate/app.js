'use strict';
(function () {
  const Gate=window.CoverageGate;
  const byId=id=>document.getElementById(id);
  const node=(tag,txt,cls)=>{
    const el=document.createElement(tag);
    if(txt!==undefined&&txt!==null) el.textContent=String(txt);
    if(cls)el.className=cls;
    return el;
  };
  const n=(value)=>Number(value).toLocaleString('ja-JP');
  const yen=value=>(value>=0?'+':'−')+n(Math.abs(value))+'円';
  const money=value=>n(value)+'円';
  const pct=value=>value===null||!Number.isFinite(value)?'—':(100*value).toFixed(1)+'%';
  let report=null;
  const fixed=Gate.FIXED;
  const state={cars:fixed.cars,maxHeads:fixed.maxHeads,period:'all',status:'all',date:'all'};
  const tone=(element,value)=>{element.classList.toggle('positive',value>0);element.classList.toggle('negative',value<0);};
  const periodText={all:'全期間',exploratory:'過去の探索期間',prospective:'条件固定後'};
  const isFixed=()=>state.cars===fixed.cars&&state.maxHeads===fixed.maxHeads;
  const rules=()=>({cars:state.cars,maxHeads:state.maxHeads});
  const subset=()=>report.races.filter(r=>state.period==='all'||(state.period==='exploratory'?r.date<report.policy.start:r.date>=report.policy.start));
  const parseReport=payload=>{
    if(payload?.schema!=='tk-coverage-gate-validation/v1'||
      !Array.isArray(payload.races)||!payload.policy||!payload.summary) throw Error('集計データの形式を確認できません。');
    return payload;
  };
  function summary() {
    const result=Gate.analyze(subset(),rules());
    const d=byId('kpi-gate'),b=byId('kpi-base'),gain=byId('kpi-saved'),trim=byId('kpi-trim');
    d.textContent=pct(result.passing.roi);b.textContent=pct(result.all.roi);
    gain.textContent=yen(-result.skipped.net);
    trim.textContent=pct(result.passing.trimmed);
    tone(gain,-result.skipped.net);
    byId('scope-summary').textContent=
      periodText[state.period]+'｜評価 '+n(result.evaluated)+'R・通過 '+n(result.passedCount)+'R・見送り '+n(result.skippedCount)+
      'R・結果待ち '+n(result.pendingCount)+'R・照合除外 '+n(result.excludedCount)+'R';
    byId('split-summary').replaceChildren(
      node('span','通常：投資 '+money(result.all.stake)+'／払戻 '+money(result.all.payout)+'／損益 '+yen(result.all.net)),
      node('br'),
      node('span','GATE：投資 '+money(result.passing.stake)+'／払戻 '+money(result.passing.payout)+'／損益 '+yen(result.passing.net)),
      node('br'),
      node('span','見送り分：投資 '+money(result.skipped.stake)+'／払戻 '+money(result.skipped.payout)+'／損益 '+yen(result.skipped.net))
    );
    byId('mode-chip').textContent=state.period==='prospective'&&isFixed()?'固定ルール追跡':isFixed()?'探索的検証／固定ルール':'探索的な条件変更';
    byId('caution').textContent= !isFixed() ?
      '現在の条件は保存済みの結果を見ながら変更可能な探索的試算です。改善が見えても、独立した将来検証を経るまで優位性は認めません。':
      state.period==='prospective' ?
      '2026年11月13日以降、事前に固定した購入条件で追跡します。予想自体は変更しません。':
      'この期間の結果を見て選別条件を検討したため、回収率は探索的バックテストです。条件固定後の実績を別途確認してください。';
  }
  function setTable(tbody,rows){
    tbody.replaceChildren(...rows.map(values=>{
      const tr=node('tr');tr.append(...values.map((v,i)=>node('td',v)));
      return tr;
    }));
  }
  function bar(el,widthPercent,cls){
    const e=node('div',undefined,'bar '+cls);
    e.style.height=Math.max(2,Math.min(100,widthPercent))+'px';return e;
  }
  function daily() {
    const days=Gate.daily(subset(),rules()),visible=days.slice(0,20);
    byId('days-count').textContent=n(days.length)+'日分';
    const max=Math.max(100,...visible.flatMap(x=>[x.all.roi||0,x.passing.roi||0]).map(x=>x*100));
    const bars=visible.slice().reverse().map(x=>{
      const item=node('div',undefined,'bar-pair'),plot=node('div',undefined,'bar-plot');
      const baseline=bar(plot,Math.round((x.all.roi||0)*10000/max),'baseline');
      const gated=bar(plot,Math.round((x.passing.roi||0)*10000/max),'gated');
      item.title=x.date+'：通常 '+pct(x.all.roi)+'／GATE '+pct(x.passing.roi);
      plot.append(baseline,gated);
      item.append(plot,node('div',x.date.slice(5).replace('-','/'),'bar-label'));return item;
    });
    const key=node('div',undefined,'bars-key');
    key.append(node('span','通常'),node('span','GATE'));
    byId('bars').replaceChildren(...bars);
    byId('bars').after(key);
    if(byId('bars').parentElement.querySelectorAll('.bars-key').length>1){
      const keys=byId('bars').parentElement.querySelectorAll('.bars-key');
      for(let i=0;i<keys.length-1;i++)keys[i].remove();
    }
    setTable(byId('daily-body'),days.map(x=>[
      x.date.slice(5).replace('-','/'),x.passedCount+'/'+x.evaluated,
      pct(x.all.roi),pct(x.passing.roi),yen(x.passing.net)
    ]));
  }
  function breakdown(){
    const rows=subset().filter(r=>r.status==='evaluated'),rulesNow=rules();
    const fmt=(label,items)=>{
      const s=Gate.analyze(items,rulesNow);
      return [label,s.evaluated,s.passing.hits+' / '+s.passedCount,pct(s.passing.roi)];
    };
    const results=[
      fmt('7車',rows.filter(r=>r.cars===7)),
      fmt('9車',rows.filter(r=>r.cars===9))
    ];
    for(const label of ['チャレンジ','A級','S級','不明']) {
      const members=rows.filter(r=>r.grade===label);
      if(members.length)results.push(fmt(label,members));
    }
    setTable(byId('breakdown-body'),results);
  }
  function updateDays(){
    const selector=byId('date-filter'),chosen=state.date;
    const dates=[...new Set(subset().map(x=>x.date))].sort().reverse();
    selector.replaceChildren(new Option('全日','all'),...dates.map(date=>new Option(date,date)));
    if(chosen!=='all'&&dates.includes(chosen))selector.value=chosen;
    else {selector.value='all';state.date='all';}
  }
  function records(){
    const chosen=subset().filter(r=>(state.date==='all'||r.date===state.date)&&
      (state.status==='all' || (state.status==='pending' ? r.status==='pending' :
      state.status==='buy'?Gate.gate(r,rules()).pass:!Gate.gate(r,rules()).pass)))
      .sort((a,b)=>b.cutoff.localeCompare(a.cutoff)||a.race_id.localeCompare(b.race_id));
    byId('race-count').textContent='該当 '+n(chosen.length)+'R。各レースの購入候補・見送りは発走前予想の内容だけで判定します。';
    const panels=chosen.slice(0,80).map(r=>{
      const g=Gate.gate(r,rules()),box=node('article',undefined,'race'),head=node('div',undefined,'race-head');
      head.append(node('span',r.date.slice(5).replace('-','/')+'　'+r.venue+r.number+'R '+r.start));
      head.append(node('span',g.pass?'購入候補':'見送り','race-state '+(g.pass?'':'skip')));
      box.append(head,node('div',(r.cars||'不明')+'車｜'+r.grade+'｜1着候補 '+r.heads+'車｜'+r.points+'点','race-meta'));
      const status=r.status==='evaluated'?(r.hit?'的中':'不的中'):(r.status==='pending'?'結果待ち':r.status==='void'?'不成立':'照合保留');
      const result=r.status==='evaluated'?
        '結果 '+status+'　払戻 '+money(r.payout)+'　投資 '+money(r.stake)+'　損益 '+yen(r.payout-r.stake):
        '結果 '+status;
      box.append(node('div',result,'race-outcome'));
      if(!g.pass)box.append(node('div','見送り理由：'+g.reasons.join('・'),'race-meta'));
      const detail=node('details'),sum=node('summary','買い目・モデルIDを確認'),tickets=node('div',undefined,'ticket-list');
      (r.tickets||[]).forEach(t=>tickets.append(node('span',t,'ticket')));
      detail.append(sum,tickets,node('div','モデル：'+r.model,'helper'),
        node('div','予想保存：'+r.saved_at+'／発走：'+r.cutoff,'helper'));
      box.append(detail);return box;
    });
    byId('races').replaceChildren(...panels);
    byId('race-limit').textContent=chosen.length>80?
      '表示は最新80件まで。CSVには該当する全'+n(chosen.length)+'Rを出力します。':'';
  }
  function exportCSV(){
    const columns=['race_id','date','venue','number','start','cars','grade','heads','pairs','points','gate','reason','status','stake','payout','net','model'];
    const arr=subset().filter(r=>(state.date==='all'||r.date===state.date)&&
      (state.status==='all'||(state.status==='pending'?r.status==='pending':
        state.status==='buy'?Gate.gate(r,rules()).pass:!Gate.gate(r,rules()).pass)));
    const rows=[columns,...arr.map(r=>{
      const g=Gate.gate(r,rules());
      const data={...r,gate:g.pass?'BUY':'SKIP',reason:g.reasons.join('/'),net:r.status==='evaluated'?r.payout-r.stake:''};
      return columns.map(k=>data[k]??'');
    })];
    const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link=node('a');link.href=url;link.download='coverage-gate-'+state.period+'-'+new Date().toISOString().slice(0,10)+'.csv';
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function render(){
    if(!report)return;
    summary();daily();breakdown();updateDays();records();
  }
  async function load(){
    try{
      const response=await fetch('data/coverage_gate/evaluation.json',{cache:'no-store'});
      if(!response.ok)throw Error('集計データを取得できません（HTTP '+response.status+'）。');
      report=parseReport(await response.json());
      byId('load-state').textContent='発走前保存 '+n(report.races.length)+'件を照合｜モデル切替日は別モデルとして保存・追跡｜読み込み完了';
      render();
      if(report.errors?.length)byId('load-state').textContent+= '｜整合性保留 '+report.errors.length+'件';
    }catch(error){byId('load-state').textContent=error.message+' GitHubの集計処理をご確認ください。';}
  }
  for(const [id,name,cast] of [['cars','cars',String],['max-heads','maxHeads',Number],['period','period',String],
    ['status-filter','status',String],['date-filter','date',String]]){
    byId(id).addEventListener('change',event=>{
      state[name]=cast(event.target.value);render();
    });
  }
  byId('reset').addEventListener('click',()=>{
    state.cars=fixed.cars;state.maxHeads=fixed.maxHeads;
    byId('cars').value=fixed.cars;byId('max-heads').value=String(fixed.maxHeads);
    render();
  });
  byId('export').addEventListener('click',()=>{if(report)exportCSV();});
  load();
})();
