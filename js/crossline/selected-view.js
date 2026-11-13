(function(){'use strict';
const $=id=>document.getElementById(id);
const jp=n=>Number(n||0).toLocaleString('ja-JP'),pct=n=>n==null?'―':(n*100).toFixed(1)+'%',yen=n=>jp(n)+'円';
const jst=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const stamp=v=>v?new Date(v).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'未取得';
const tag=(name,text,className)=>{const e=document.createElement(name);if(text!==undefined)e.textContent=String(text);if(className)e.className=className;return e;};
let day=null,weights=null,history=null,current=null,loaded=false,revision=0,listRevision=0,currentList=null;
const status=s=>{$('status').textContent=s;};
async function json(url){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
 try{const r=await fetch(url,{signal:ctrl.signal,cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}
 finally{clearTimeout(timer);}
}
async function model(){
 if(weights)return weights;
 const j=await json('reports/mansha/crossline-pair-third-v1.json');
 if(!CrosslineSelected.validWeights(j.models))throw Error('固定係数を確認できません');
 weights=j.models;return weights;
}
async function fetchDay(date){
 let err;
 for(const root of ['https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/','https://kurinaka12-afk.github.io/keirin-app-data/']){
  try{const d=await json(root+date+'.json');if(d.date!==date||!Array.isArray(d.races)||d.races.length>250)throw Error('配信形式が不正');return d;}
  catch(e){err=e;}
 }
 throw err||Error('出走表を取得できません');
}
const supported=r=>!r.is_girls&&r.entries?.length===7&&r.entries.every(x=>/^A[123]$/.test(String(x.class_rank||'')));
const raceId=r=>[r.date,r.venue,r.race_no].join(':');
function chooseVenue(value){
 const venues=[...new Set((day?.races||[]).filter(supported).map(x=>x.venue))];
 $('venue').replaceChildren(...venues.map(x=>new Option(x,x)));
 if(venues.includes(value))$('venue').value=value;
 $('venue').disabled=!venues.length;chooseRace();
}
function chooseRace(value){
 const races=(day?.races||[]).filter(x=>supported(x)&&x.venue===$('venue').value).sort((a,b)=>a.race_number-b.race_number);
 $('race').replaceChildren(...races.map(x=>new Option(x.race_number+'R',x.race_number)));
 if(races.some(x=>String(x.race_number)===String(value)))$('race').value=String(value);
 $('race').disabled=!races.length;$('predict').disabled=!races.length;
}
async function refresh(){
 const seq=++revision;day=null;current=null;loaded=false;
 $('result').hidden=true;$('copy').disabled=true;$('predict').disabled=true;
 $('venue').disabled=true;$('race').disabled=true;status('公開出走表を確認しています');
 try{
  const d=await fetchDay($('date').value);if(seq!==revision)return;
  day=d;const q=new URLSearchParams(location.search);
  chooseVenue(q.get('date')===d.date?q.get('venue'):'');
  if(q.get('date')===d.date&&q.get('venue')===$('venue').value)chooseRace(q.get('r'));
  status(day.races.length?'対象のレースを選んで予想を表示できます。':'この日の出走表はまだ配信されていません。');
  void renderCandidateList();
 }catch(e){if(seq!==revision)return;status('出走表を取得できませんでした：'+e.message);void renderCandidateList();}
}
const formatPairs=p=>p.map(x=>x.join('-')).join('、');

function formatCopy(r){
 return r.venue+' '+r.race_no+'R　発走予定 '+r.start+'（'+r.date+'）\n'+
  r.forecast.tickets.map(t=>t+'　100円').join('\n')+'\n合計 400円';
}
async function copyTickets(content,btn){
 try{
  if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
  await navigator.clipboard.writeText(content);
  const old=btn.textContent;btn.textContent='コピーしました';
  setTimeout(()=>{btn.textContent=old;},1500);
 }catch(_){$('candidate-status').textContent='コピーできませんでした。表示されている買い目を選択してご利用ください。';}
}
function candidateMetric(label,value){
 const d=tag('div',null,'candidate-total');d.append(tag('small',label),tag('strong',value));return d;
}
function drawCandidateList(data,modelError=null){
 currentList=data;
 $('candidate-stats').replaceChildren(
  candidateMetric('発走前の購入候補',jp(data.upcoming.length)+' レース'),
  candidateMetric('合計購入点数',jp(data.points)+' 点'),
  candidateMetric('1レースの想定額','400 円'),
  candidateMetric('全対象の想定額',yen(data.stake))
 );
 $('candidate-copy-all').disabled=data.upcoming.length===0;
 const extra=[];
 if(modelError)extra.push('当日再計算不可：'+modelError);
 if(!data.feed_ok)extra.push('公開出走表の取得待ち。保存済み予想のみを表示しています');
 if(data.invalid.length)extra.push('確認できないレース '+data.invalid.length+'件');
 $('candidate-status').textContent='表示：'+data.date+' ／ 発走前候補 '+data.upcoming.length+'R ／ 発走済候補 '+data.concluded.length+'R ／ 見送り '+data.skipped.length+'R'+
  (extra.length?' ／ '+extra.join(' ／ '):'');
 const frag=document.createDocumentFragment();
 if(!data.upcoming.length)frag.append(tag('p','発走前の購入候補は現在ありません。見送り・発走済みは下の欄で確認できます。','candidate-empty'));
 for(const row of data.upcoming){
  const d=tag('article',null,'candidate-card');
  const head=tag('div',null,'candidate-head');
  const name=tag('div',null,'candidate-heading');
  name.append(tag('span',row.venue+' '+row.race_no+'R'),tag('div','発走予定 '+row.start+'　／　'+(row.forecast.category==='C7'?'チャレンジ':'A級')+'7車','candidate-time'));
  head.append(name,tag('span','4点購入候補','candidate-badge'));d.append(head);
  d.append(tag('p','万車リスク '+(row.forecast.risk?.percent?.toFixed(1)??'―')+'%　／　別線1・2着 '+formatPairs(row.forecast.pairs),'candidate-pairs'));
  const ticks=tag('div',null,'candidate-tickets');
  for(const ticket of row.forecast.tickets)ticks.append(tag('div',ticket,'candidate-ticket'));
  d.append(ticks);
  const footer=tag('div',null,'candidate-footer'),copy=tag('button','4点をコピー');
  footer.append(tag('strong','各100円 ／ 計400円'),copy);d.append(footer);
  copy.type='button';copy.addEventListener('click',()=>copyTickets(formatCopy(row),copy));
  d.append(tag('p',row.source==='frozen'?'発走前固定保存 '+stamp(row.saved_at):'当日出走表から計算・未固定', 'candidate-source'));
  frag.append(d);
 }
 $('candidate-list').replaceChildren(frag);
 $('candidate-concluded-title').textContent='発走済みの購入候補（'+data.concluded.length+'R）';
 const concluded=document.createDocumentFragment();
 for(const row of data.concluded){
  const d=tag('div',null,'candidate-mini');
  d.append(tag('strong',row.venue+' '+row.race_no+'R　'+row.start+'　／　4点400円'));
  d.append(tag('div',row.forecast.candidate4.join(' ／ ')));
  d.append(tag('div','発走済みのため現在の購入対象には含めません。'));
  concluded.append(d);
 }
 if(!data.concluded.length)concluded.append(tag('p','該当レースはありません。','fine'));
 $('candidate-concluded').replaceChildren(concluded);
 $('candidate-skipped-title').textContent='見送りレース（'+data.skipped.length+'R）';
 const skipped=document.createDocumentFragment();
 for(const row of data.skipped){
  const d=tag('div',null,'candidate-mini');
  d.append(tag('strong',row.venue+' '+row.race_no+'R　'+row.start));
  d.append(tag('div',row.forecast.reason+' ／ 投資0円'));
  skipped.append(d);
 }
 if(!data.skipped.length)skipped.append(tag('p','見送りレースはありません。','fine'));
 $('candidate-skipped').replaceChildren(skipped);
}
async function renderCandidateList(){
 const seq=++listRevision,date=$('date').value;
 $('candidate-status').textContent='購入対象レースを集計しています。';
 let w=null,error=null;
 if(day?.date===date&&day.races?.some(CrosslineCandidateList.supported)){
  try{w=await model();}catch(e){error=e.message;}
 }
 if(seq!==listRevision||date!==$('date').value)return;
 try{
  const result=CrosslineCandidateList.assemble({date,feed:day?.date===date?day:null,
   rows:history?.rows||[],now:Date.now(),weights:w,riskLib:ManshaRisk,
   riskModel:ManshaRiskModel,convert:RaceFeed.convert,predict:CrosslineSelected.predict});
  drawCandidateList(result,error);
 }catch(e){$('candidate-status').textContent='購入候補一覧を作成できません：'+e.message;}
}

function showForecast(f,{source='recomputed',date=null,venue=null,raceNo=null,time=null,sourceGeneratedAt=null,savedAt=null,evaluation=null}={}){
 current={forecast:f,source};$('result').hidden=false;$('copy').disabled=!(source==='live'&&f.eligible);
 const active=f.eligible;
 $('verdict').textContent=active?'購入候補4点':'見送り';
 $('verdict').className=active?'flag selected':'flag skipped';
 $('reason').textContent=f.reason;
 $('risk').textContent='万車リスク '+(f.risk?f.risk.percent.toFixed(1)+'% ／ '+f.risk.band:'判定対象外');
 $('lineup').textContent='別線1・2着候補 '+formatPairs(f.pairs||[]);
 $('event').textContent=[date,venue,raceNo?raceNo+'R':null,time].filter(Boolean).join(' ／ ');
 $('tickets').replaceChildren();
 for(const t of f.candidate4||[]){
  const e=tag('div',t,'bet');if(!active)e.classList.add('muted-bet');$('tickets').append(e);
 }
 $('points').textContent=active?'4点×100円＝400円':'投資対象外：0円（下の4点は比較研究用）';
 const sourceText=source==='frozen'?'発走前固定保存済み：'+stamp(savedAt):
  source==='live'?'発走前予測・この画面の再計算（自動保存実績とは別）':
  '過去の出走表から再計算（発走前に固定した予想ではありません）';
 $('source').textContent=sourceText+' ／ 配信時点 '+stamp(sourceGeneratedAt)+' ／ モデル '+f.version;
 $('outcome').textContent=evaluation?.status==='evaluated'?'結果 '+evaluation.actual.map(x=>x.key+'・'+yen(x.payout)).join('／')+' ／ 仮想払戻 '+yen(evaluation.selected4.payout):
  evaluation?.status==='pending'?'結果待ち':evaluation?.status==='excluded'?'評価除外：'+evaluation.reason:'';
}
function frozenFor(id){return history?.rows?.find(x=>x.race_id===id);}
async function predict(){
 if(!day){status('先に開催日を読み込んでください');return;}
 const seq=++revision;$('predict').disabled=true;status('従来別線4点＋Phase 3選別を計算しています');
 try{
  const source=day.races.find(x=>x.venue===$('venue').value&&String(x.race_number)===$('race').value);
  if(!source)throw Error('レースが見つかりません');
  const r=RaceFeed.convert(source,day),now=Date.now(),cutoff=Date.parse(r.date+'T'+r.start+':00+09:00');
  const archived=frozenFor(raceId(r));
  if(archived&&Date.parse(archived.saved_at)<Date.parse(archived.forecast?.cutoff||r.date+'T'+r.start+':00+09:00')){
   showForecast(archived.forecast,{source:'frozen',date:r.date,venue:r.venue,raceNo:r.race_no,time:r.start,
    sourceGeneratedAt:archived.source_generated_at,savedAt:archived.saved_at,evaluation:archived.evaluation});
   status('固定保存した予測を表示しています');return;
  }
  const [w]=await Promise.all([model()]);
  if(seq!==revision)return;
  const f=CrosslineSelected.predict(r,w,ManshaRisk,ManshaRiskModel);
  const historical=!(Date.parse(day.generated_at)<cutoff&&now<cutoff&&Date.parse(day.generated_at)<=now);
  showForecast(f,{source:historical?'retrospective':'live',date:r.date,venue:r.venue,raceNo:r.race_no,time:r.start,sourceGeneratedAt:day.generated_at});
  status(historical?'参考再計算です。保存済み発走前予想ではありません。':'発走前のモデル判定を表示しました。');
 }catch(e){if(seq!==revision)return;status('予想できません：'+e.message);}
 finally{if(seq===revision)$('predict').disabled=false;}
}
function rowStat(label,value){const d=tag('div',null,'kpi');d.append(tag('small',label),tag('strong',value));return d;}
function showSummary(){
 if(!history){$('health').textContent='発走前の固定予想・結果照合データはまだありません。';return;}
 const s=history.summary,selected=s.views.selected4,all=s.views.all4;
 $('health').textContent='発走前固定 '+jp(s.saved)+'R ／ 対象 '+jp(s.selected_saved)+'R ／ 結果照合 '+jp(s.eval)+'R ／ 結果待ち '+jp(s.pending)+'R';
 $('updated').textContent='集計更新 '+stamp(history.generated_at)+' ／ 1点100円の仮想成績';
 $('metrics').replaceChildren(
  rowStat('選別4点・回収率',pct(selected.roi)),
  rowStat('選別4点・収支',(selected.net>0?'+':'')+yen(selected.net)),
  rowStat('選別4点・的中',jp(selected.hits)+'R'),
  rowStat('最高払戻3件除外',pct(selected.trim3)),
  rowStat('選別なし4点・回収率',pct(all.roi)),
  rowStat('購入候補となったレース',jp(selected.selected)+'R')
 );
 const rows=history.rows.slice().sort((a,b)=>b.date.localeCompare(a.date)||a.venue.localeCompare(b.venue,'ja')||a.race_no-b.race_no);
 const frag=document.createDocumentFragment();
 for(const x of rows.slice(0,80)){
  const d=tag('details',null,'history-row'),summary=tag('summary',x.date+' '+x.venue+' '+x.race_no+'R ・ '+(x.forecast.eligible?'4点候補':'見送り')+' ・ '+({evaluated:'照合済み',pending:'結果待ち',excluded:'評価対象外'}[x.evaluation.status]||x.evaluation.status));
  d.append(summary,tag('p','別線ペア：'+formatPairs(x.forecast.pairs)+' ／ '+x.forecast.reason));
  d.append(tag('p','予想4点：'+x.forecast.candidate4.join('・'),'ticketline'));
  if(x.evaluation.status==='evaluated')d.append(tag('p','確定 '+x.evaluation.actual.map(t=>t.key+' '+yen(t.payout)).join('／')+' ／ 対象仮想払戻 '+yen(x.evaluation.selected4.payout)));
  frag.append(d);
 }
 $('history').replaceChildren(frag);
}
async function loadHistory(){
 try{
  const x=await json('data/crossline_selected/evaluation.json?ts='+Date.now());
  if(x.schema!=='tk-crossline-selected-evaluation/v1'||!Array.isArray(x.rows))throw Error('保存形式が異なります');
  history=x;showSummary();void renderCandidateList();
 }catch(_){$('health').textContent='発走前の固定予想・結果照合データはまだありません。';void renderCandidateList();}
}
$('date').value=new URLSearchParams(location.search).get('date')||jst();
$('date').addEventListener('change',refresh);
$('candidate-refresh').addEventListener('click',()=>{void refresh();void loadHistory();});
$('candidate-copy-all').addEventListener('click',()=>{
 if(!currentList?.upcoming?.length)return;
 void copyTickets(currentList.upcoming.map(formatCopy).join('\n\n'),$('candidate-copy-all'));
});
setInterval(()=>{if(currentList?.upcoming?.length)void renderCandidateList();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void renderCandidateList();});

$('venue').addEventListener('change',()=>chooseRace());
$('race').addEventListener('change',()=>{$('result').hidden=true;});
$('predict').addEventListener('click',predict);
$('copy').addEventListener('click',async()=>{
 if(!current||current.source!=='live'||!current.forecast.eligible)return;
 const text=current.forecast.tickets.join('\n');
 try{await navigator.clipboard.writeText(text);$('copy').textContent='コピーしました';setTimeout(()=>$('copy').textContent='4点をコピー',1800);}
 catch(_){$('copy').textContent='コピーできませんでした';}
});
refresh();loadHistory();
})();
