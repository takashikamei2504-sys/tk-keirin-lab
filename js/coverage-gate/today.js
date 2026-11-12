'use strict';
/* Today's COVERAGE-GATE review is independent of the ROI wager/odds policy.
 * Frozen coverage tickets and their saved-before-start timestamp are authoritative.
 */
(function () {
  const Gate=window.CoverageGate;
  const id=name=>document.getElementById(name);
  const el=(tag,text,cls)=>{
    const e=document.createElement(tag);
    if(text!==undefined)e.textContent=String(text);
    if(cls)e.className=cls;
    return e;
  };
  const todayJst=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const clockJst=iso=>iso?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso)):'—';
  const n=value=>Number(value).toLocaleString('ja-JP');
  const money=value=>n(value)+'円';
  const fixed=Gate.FIXED;
  const frozenCache=new Map();
  const statusFilter=id('today-filter');
  const state={date:'',records:[],indexDate:null,source:null,loading:false,generation:0};
  const fetchJSON=async url=>{
    try {
      const response=await fetch(url,{cache:'no-store'});
      return response.ok?await response.json():null;
    } catch (_) {return null;}
  };
  const isValidIndexRow=(entry,date,model)=>{
    if(!entry || entry.model!==model ||
      !entry.race || entry.race.date!==date ||
      entry.race_id!==[date,entry.race.venue,entry.race.number].join(':') ||
      !/^[a-f0-9]{64}\.json$/.test(entry.file||'') ||
      !(Date.parse(entry.saved_at)<Date.parse(entry.cutoff)) ||
      !Array.isArray(entry.candidates)||!entry.candidates.length||entry.candidates.length>10||
      new Set(entry.candidates).size!==entry.candidates.length ||
      !entry.candidates.every(Gate.validKey))return false;
    return true;
  };
  async function loadFrozen(entry,date) {
    const file='data/roi/forecasts/'+date+'/'+entry.file;
    let detail=frozenCache.get(file);
    if(!detail){detail=await fetchJSON(file);if(detail)frozenCache.set(file,detail);}
    if(!detail || detail.race_id!==entry.race_id ||
      detail.model?.model_id!==entry.model || detail.cutoff!==entry.cutoff ||
      detail.saved_at!==entry.saved_at ||
      JSON.stringify(detail.race)!==JSON.stringify(entry.race) ||
      JSON.stringify(detail.comparison?.coverage)!==JSON.stringify(entry.candidates) ||
      !Array.isArray(detail.identity)||![7,9].includes(detail.identity.length)) return null;
    const rec=Gate.makeRace(entry,null,{cars:detail.identity.length});
    return rec?{...rec,source:'frozen'}:null;
  }
  async function batch(entries,date,prior,generation){
    const out=Array(entries.length).fill(null);
    let cursor=0;
    async function worker(){
      while(cursor<entries.length && generation===state.generation){
        const i=cursor++,entry=entries[i],previous=prior.get(entry.race_id);
        if(previous && previous.model===entry.model && previous.saved_at===entry.saved_at &&
          previous.cutoff===entry.cutoff && previous.tickets?.join('|')===entry.candidates.join('|') &&
          [7,9].includes(previous.cars)) {
          out[i]={...previous,source:'audited'};
        } else {
          out[i]=await loadFrozen(entry,date);
        }
        if(generation===state.generation) {
          state.records=out.filter(Boolean);
          render();
        }
      }
    }
    await Promise.all(Array.from({length:Math.min(6,entries.length)},worker));
    return out;
  }
  const active=r=>Date.parse(r.cutoff)>Date.now();
  const label=r=>r.venue+r.number+'R';
  const grade=r=>r.grade&&r.grade!=='不明'?r.grade+'｜':'';
  const verdict=r=>Gate.gate(r,fixed);
  function statuses(records){
    const upcoming=records.filter(active),passed=records.filter(r=>verdict(r).pass);
    const eligible=upcoming.filter(r=>verdict(r).pass);
    return {upcoming,passed,eligible,skipped:records.length-passed.length};
  }
  function nextLabel(r){
    if(active(r))return '発走前';
    if(r.status==='evaluated')return r.hit?'的中（仮想）':'不的中';
    if(r.status==='unverified')return '結果照合保留';
    return '発走済・結果集計待ち';
  }
  function controls(){
    const cars=id('cars').value,heads=Number(id('max-heads').value);
    return {cars, maxHeads:heads};
  }
  function ruleChanged(){
    const rule=controls();
    return rule.cars!==fixed.cars||rule.maxHeads!==fixed.maxHeads;
  }
  const notify=message=>{
    id('today-alert').textContent=message;
  };
  function makeCard(r){
    const decision=verdict(r),isLive=active(r),card=el('article',undefined,'today-race'),
      heading=el('div',undefined,'today-race-heading'),left=el('div'),right=el('div',undefined,'today-race-chips');
    left.append(el('strong',label(r)),el('span','発走 '+r.start,'today-time'));
    const badge=el('span',decision.pass?'GATE通過':'見送り','race-state '+(decision.pass?'':'skip'));
    right.append(badge);
    if(ruleChanged()){
      const trial=Gate.gate(r,controls());
      right.append(el('span','試算 '+(trial.pass?'通過':'見送り'),'today-trial'));
    }
    heading.append(left,right);
    card.append(heading);
    card.append(el('div',grade(r)+r.cars+'車｜1着候補 '+r.heads+'車｜'+r.tickets.length+'点｜'+nextLabel(r),'race-meta'));
    if(!decision.pass)card.append(el('div','見送り理由：'+decision.reasons.join('・'),'today-reason'));
    const details=el('details');
    details.open=decision.pass&&isLive;
    details.append(el('summary',decision.pass?'三連単の研究候補を表示':'保存された予想を確認'));
    const tickets=el('div',undefined,'ticket-list');
    r.tickets.forEach(k=>tickets.append(el('span',k,'ticket')));
    details.append(tickets);
    if(decision.pass){
      const actions=el('div',undefined,'today-actions'),
        copy=el('button','買い目をコピー','today-copy');
      copy.type='button';
      copy.addEventListener('click',async ()=>{
        const copied=r.tickets.join(', ');
        try {
          await navigator.clipboard.writeText(copied);
          copy.textContent='コピーしました';
        }catch(_){
          copy.textContent='コピーできませんでした';
        }
      });
      actions.append(copy,el('span','研究候補・各100円換算 '+money(r.tickets.length*100),'helper'));
      details.append(actions);
    }
    details.append(el('div','保存時刻 '+clockJst(r.saved_at)+'（JST）｜発走 '+r.start+'｜モデル '+r.model,'helper'));
    if(r.status==='evaluated')details.append(el('div','払戻 '+money(r.payout)+'／仮想投資 '+money(r.stake),'helper'));
    card.append(details);
    return card;
  }
  function render(){
    const current=todayJst();
    if(state.date!==current)return;
    const records=state.records.slice().sort((a,b)=>
      (active(b)?1:0)-(active(a)?1:0) || a.cutoff.localeCompare(b.cutoff) ||
      a.race_id.localeCompare(b.race_id));
    const all=statuses(records);
    id('today-date').textContent=current+'（JST）';
    id('today-pass').textContent=String(all.passed.length);
    id('today-skip').textContent=String(all.skipped);
    id('today-upcoming').textContent=String(all.eligible.length);
    const kind=statusFilter.value;
    const filtered=records.filter(r=>
      kind==='all' ||
      (kind==='candidate' ? active(r)&&verdict(r).pass :
       kind==='upcoming' ? active(r) :
       kind==='pass'?verdict(r).pass:!verdict(r).pass));
    id('today-count').textContent='表示 '+filtered.length+'R／取得済み '+records.length+'R';
    if(!records.length){
      id('today-list').replaceChildren(el('p',
        state.loading?'当日の保存予想を取得しています…':'本日の発走前保存coverage予想はまだありません。更新してご確認ください。','empty'));
    }else if(!filtered.length) {
      id('today-list').replaceChildren(el('p',
        kind==='candidate'?'発走前のGATE通過レースはありません。表示条件を変更すると保存済みの予想を確認できます。':kind==='upcoming'?'表示できる発走前予想はありません。全件表示で保存済みの予想を確認できます。':'該当するレースはありません。','empty'));
    }else id('today-list').replaceChildren(...filtered.map(makeCard));
  }
  async function load(){
    if(state.loading)return;
    state.loading=true;const generation=++state.generation,date=todayJst();
    state.date=date;state.records=[];state.indexDate=null;state.source=null;
    id('today-date').textContent=date+'（JST）';
    notify('当日の発走前予想を確認しています…');
    render();
    try {
      const [index,report]=await Promise.all([
        fetchJSON('data/roi/forecasts/'+date+'/index.json'),
        fetchJSON('data/coverage_gate/evaluation.json')
      ]);
      if(generation!==state.generation)return;
      const previous=new Map((report?.races||[]).filter(r=>r.date===date).map(r=>[r.race_id,r]));
      if(!index || index.date!==date || !Array.isArray(index.rows)){
        state.records=[...previous.values()];
        notify(state.records.length ?
          '最新の集計ファイルに保存された当日の予想を表示しています。':
          '本日分のROI coverage発走前保存予想はまだ公開されていません。');
        render();return;
      }
      state.indexDate=index.date;state.source='index';
      const valid=index.rows.filter(r=>isValidIndexRow(r,date,index.model));
      const count=index.rows.filter(r=>r.model===index.model).length;
      notify('発走前保存を確認：'+valid.length+'R'+(count>valid.length?'（整合性未確認 '+(count-valid.length)+'R）':''));
      await batch(valid,date,previous,generation);
      if(generation!==state.generation)return;
      const incomplete=valid.length-state.records.length;
      notify('発走前保存 '+valid.length+'R／判定可能 '+state.records.length+'R'+
        (incomplete?'／照合・取得保留 '+incomplete+'R':'')+
        '　|　データは配信・保存処理の更新後に反映します。');
      render();
    }catch(error){
      if(generation===state.generation)notify('当日の予想を取得できませんでした。更新をお試しください。');
    }finally {
      if(generation===state.generation){state.loading=false;render();}
    }
  }
  id('today-refresh').addEventListener('click',load);
  statusFilter.addEventListener('change',render);
  for(const name of ['cars','max-heads'])id(name).addEventListener('change',render);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
  setInterval(()=>{if(!document.hidden)load();},120000);
  load();
})();
