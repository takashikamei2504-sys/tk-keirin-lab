/* Read-only iPhone UI for first-write forward 4/6/8/10 research snapshots. */
(function(){'use strict';
const $=id=>document.getElementById(id),counts=[4,6,8,10];
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const money=x=>Number(x||0).toLocaleString('ja-JP')+'円';
const text=(tag,s,cls)=>{const e=document.createElement(tag);e.textContent=s;if(cls)e.className=cls;return e;};
const roi=x=>x==null?'―':(x*100).toFixed(1)+'%';
const scopeLabel={selected:'購入対象',skipped:'見送り（仮購入）',all:'全レース（仮購入）'};
let source=null;
function tile(title,value){const div=text('div',null,'tile');div.append(text('small',title),text('strong',value));return div;}
function aggregate(rows){
 const valid=rows.filter(x=>x.evaluation?.status==='evaluated'),variants={};
 for(const n of counts){
  const numbers=valid.map(x=>x.evaluation.values[String(n)]),stake=n*100*valid.length,payout=numbers.reduce((s,x)=>s+x.payout,0);
  const sorted=numbers.slice().sort((a,b)=>b.payout-a.payout),trim=k=>{
   const rest=sorted.slice(k),cost=rest.reduce((s,x)=>s+x.stake,0);
   return cost?rest.reduce((s,x)=>s+x.payout,0)/cost:null;
  };
  variants[String(n)]={hits:numbers.filter(x=>x.hit).length,stake,payout,net:payout-stake,roi:stake?payout/stake:null,trim1:trim(1),trim3:trim(3)};
 }
 return {evaluated:valid.length,pending:rows.filter(x=>x.evaluation?.status==='pending').length,excluded:rows.filter(x=>x.evaluation?.status==='excluded').length,variants};
}
function draw(){
 if(!source)return;
 const date=$('date').value,scope=$('scope').value,base=source.rows||[];
 const rows=base.filter(x=>(date==='all'||x.date===date)&&(scope==='all'||(scope==='selected'?x.eligible:!x.eligible)));
 const sums=aggregate(rows);$('tiles').replaceChildren(
  tile('保存済みの対象',rows.length+'R'),tile('結果照合済み',sums.evaluated+'R'),
  tile('結果待ち',sums.pending+'R'),tile('評価除外',sums.excluded+'R')
 );
 const table=document.createDocumentFragment();
 for(const n of counts){
  const v=sums.variants[String(n)],tr=document.createElement('tr');
  for(const value of [n+'点',v.hits+'R',money(v.stake),money(v.payout),money(v.net),roi(v.roi)])tr.append(text('td',value));
  table.append(tr);
 }
 $('table').replaceChildren(table);
 $('trim').textContent='最大払戻1件除外後：'+counts.map(n=>n+'点 '+roi(sums.variants[String(n)].trim1)).join(' ／ ')+
  '\n最大払戻3件除外後：'+counts.map(n=>n+'点 '+roi(sums.variants[String(n)].trim3)).join(' ／ ');
 $('trim').style.whiteSpace='pre-line';
 $('status').textContent='集計更新：'+new Date(source.generated_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+
  ' ／ '+scopeLabel[scope]+' ／ 対象日：'+(date==='all'?'全期間':date)+
  (source.errors?.length?' ／ 保存検証エラー '+source.errors.length+'件':'');
 const area=document.createDocumentFragment();
 if(!rows.length)area.append(text('p','この条件で発走前保存された予想はまだありません。出走表公開・保存時刻と自動処理の状況をご確認ください。','empty'));
 for(const r of rows.slice().sort((a,b)=>b.date.localeCompare(a.date)||a.start.localeCompare(b.start)||a.venue.localeCompare(b.venue,'ja'))){
  const div=text('article',null,'race-card'),head=text('div',null,'race-head');
  const title=text('h3',r.date+'　'+r.venue+' '+r.race_no+'R');
  const flag=text('span',r.eligible?'購入対象4点':'見送り','badge-mini'+(r.eligible?'':' skip'));
  head.append(title,flag);div.append(head);
  div.append(text('p','発走 '+r.start+' ／ '+r.reason+' ／ 万車リスク '+(r.risk_percent??'―')+'%','micro'));
  const outcome=r.evaluation?.status==='evaluated'?r.evaluation.actual.map(x=>x.key+'（'+money(x.payout)+'）').join('、'):
   r.evaluation?.status==='excluded'?'評価対象外':'結果待ち';
  div.append(text('p','結果：'+outcome,'micro'));
  for(const n of counts){
   const details=document.createElement('details');details.className='variant';
   if(n===4)details.open=true;
   const res=r.evaluation?.values?.[String(n)],label=n+'点'+
     (res?' ／ '+(res.hit?'的中 ':'不的中 ')+money(res.payout)+' ／ 回収率 '+roi(res.payout/res.stake):' ／ 結果待ち');
   details.append(text('summary',label));
   const grid=text('div',null,'tickets-grid');
   for(const [i,ticket] of (r.variants?.[String(n)]||[]).entries())grid.append(text('span',ticket,'ticket'+(i>=4?' extra':'')));
   details.append(grid);div.append(details);
  }
  area.append(div);
 }
 $('races').replaceChildren(area);
}
async function refresh(){
 $('status').textContent='保存済み予想と結果を更新しています。';
 try{
  const response=await fetch('data/crossline_expanded/evaluation.json?ts='+Date.now(),{cache:'no-store'});
  if(!response.ok)throw Error('HTTP '+response.status);
  const obj=await response.json();
  if(obj.schema!=='tk-crossline-expanded-evaluation/v1'||!Array.isArray(obj.rows))throw Error('研究データの形式が不正');
  source=obj;const prev=$('date').value;
  const options=[['all','全期間'],[today(),'今日 '+today()],...[...new Set(obj.rows.map(x=>x.date))].filter(d=>d!==today()).sort().reverse().map(x=>[x,x])];
  $('date').replaceChildren(...options.map(([value,label])=>{const o=document.createElement('option');o.value=value;o.textContent=label;return o;}));
  $('date').value=options.some(([d])=>d===prev)?prev:today();
  draw();
 }catch(e){
  source=null;$('status').textContent='データを取得できませんでした：'+e.message;
  $('tiles').replaceChildren();$('table').replaceChildren();$('races').replaceChildren(text('p','検証データがまだ公開されていない可能性があります。','empty'));
 }
}
$('date').value=today();$('date').addEventListener('change',draw);$('scope').addEventListener('change',draw);
$('refresh').addEventListener('click',refresh);void refresh();
})();
