/* Read-only projection of frozen research snapshots. No engine or storage writes. */
(function(root){
"use strict";
const methods=[["A_original","A 現行"],["B_third","B 3着補完"],["C_pair","C 穴目ペア"],["D_hybrid","D 併用"],["E_capped_skip","E 上限・見送り"]];
const base="data/mrt_research/micro_forward/";
const sum=t=>t.reduce((n,x)=>n+x.yen,0);
const key=t=>t.cars.join("-");
const validTime=x=>typeof x==="string"&&Number.isFinite(Date.parse(x));
const yen=x=>Number.isFinite(x)?x.toLocaleString("ja-JP")+"円":"—";
const pct=x=>Number.isFinite(x)?x.toFixed(1)+"%":"—";
const signed=x=>Number.isFinite(x)?(x>0?"+":"")+yen(x):"—";
const isoDate=d=>d.slice(0,4)+"-"+d.slice(4,6)+"-"+d.slice(6,8);
const clock=x=>validTime(x)?new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(x)):"—";
const stamp=x=>validTime(x)?new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(x)):"—";
const sameRoster=(a,b)=>!!a&&!!b&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&String(a[k])===String(b[k]));
function validate(s,id){
 if(s?.schema!=="tk-mrt-micro-forward/v1"||s.race_id!==id||s.date!==id.slice(0,8)||!s.frozen||!s.pre_race||!s.protocol_id||!s.identity_sha256)throw Error("固定予想の識別情報が不正です");
 const ts=[s.entry_observed_at,s.original_generated_at,s.generated_at,s.sales_close_at,s.start_at];
 if(!ts.every(validTime)||!(Date.parse(ts[0])<=Date.parse(ts[1])&&Date.parse(ts[1])<=Date.parse(ts[2])&&Date.parse(ts[2])<Date.parse(ts[3])&&Date.parse(ts[3])<Date.parse(ts[4])))throw Error("締切前の固定時刻を確認できません");
 const cars=Object.keys(s.roster||{});if(![7,9].includes(cars.length))throw Error("対象車数不正");
 for(const [m] of methods){
  const t=s.methods?.[m];
  if(!Array.isArray(t)||!t.every(x=>Array.isArray(x.cars)&&x.cars.length===3&&new Set(x.cars).size===3&&x.cars.every(c=>cars.includes(String(c)))&&Number.isInteger(x.yen)&&x.yen>=100&&x.yen%100===0)||new Set(t.map(key)).size!==t.length)throw Error("買い目形式不正 "+m);
  if(m==="E_capped_skip"?(sum(t)!==(s.decision?.no_buy?0:5000)):sum(t)!==10000)throw Error("仮想金額不一致 "+m);
 }
 return s;
}
function resultState(s,r,entry){
 if(entry?.identity_sha256&&entry.identity_sha256!==s.identity_sha256)return {status:"excluded",reason:"現在の出走情報と固定予想の識別情報が異なります"};
 if(!r)return {status:"pending",reason:"確定結果の取得待ち"};
 if(r.status!=="final")return {status:r.status==="pending"?"pending":"excluded",reason:r.status==="pending"?"確定結果の取得待ち":"結果照合未確認・評価除外"};
 if(r.race_id!==s.race_id||!sameRoster(s.roster,r.roster))return {status:"excluded",reason:"レースまたは選手登録番号不一致"};
 const pays=Object.entries(r.payouts||{});
 if(!pays.length||!pays.every(([k,v])=>/^[1-9]-[1-9]-[1-9]$/.test(k)&&new Set(k.split("-")).size===3&&k.split("-").every(c=>Object.hasOwn(s.roster,c))&&Number.isInteger(v)&&v>0))return {status:"excluded",reason:"三連単払戻の形式不正"};
 return {status:"final",payouts:r.payouts};
}
function evaluate(t,state){const stake=sum(t);if(state.status!=="final")return {stake,pay:null,net:null};const pay=t.reduce((n,x)=>n+(state.payouts[key(x)]||0)*x.yen/100,0);return {stake,pay,net:pay-stake};}
function tickets(s,m,state){const original=new Map(s.methods.A_original.map(t=>[key(t),t.yen]));return s.methods[m].map(t=>({...t,combo:key(t),added:!original.has(key(t)),delta:t.yen-(original.get(key(t))||0),hit:state.status==="final"&&Object.hasOwn(state.payouts,key(t))}));}
function catalog(x){if(x?.schema!=="tk-mrt-micro-view-index/v1"||!Array.isArray(x.race_ids)||!x.race_ids.every(id=>/^\d{12}$/.test(id)))throw Error("研究一覧の形式が異なります");return [...new Set(x.race_ids)].sort();}
function labelOrigin(t){return t.origin==="third"?"3着補完":t.origin==="pair"?"別ペア":"追加";}
const api={methods,validate,resultState,evaluate,tickets,catalog};
if(typeof module==="object"&&module.exports){module.exports=api;return;}
const $=id=>document.getElementById(id);
const txt=(id,v)=>{$(id).textContent=v};
const show=(id,on)=>{$(id).hidden=!on};
const opts=(id,items,value)=>{const e=$(id);e.replaceChildren(...items.map(([v,n])=>{const o=document.createElement("option");o.value=v;o.textContent=n;return o}));e.disabled=!items.length;if(items.some(x=>x[0]===value))e.value=value;};
const cell=(tr,v,cls)=>{const td=document.createElement("td");td.textContent=v;if(cls)td.className=cls;tr.append(td);return td};
const line=(target,values)=>{const tr=document.createElement("tr");for(const v of values)Array.isArray(v)?cell(tr,v[0],v[1]):cell(tr,v);target.append(tr);return tr};
async function get(path,optional=false){const r=await fetch(path,{cache:"no-store"});if(optional&&r.status===404)return null;if(!r.ok)throw Error("取得失敗 "+r.status+" : "+path);return r.json();}
let ids=[],dayRows=[],dayResults=[],report=null,selected=null,state=null,method="A_original",version=0;
let deep=new URLSearchParams(location.search).get("race");if(!/^\d{12}$/.test(deep||""))deep=null;
function metric(label,value){const d=document.createElement("div");d.className="metric";const b=document.createElement("b");b.textContent=value;const l=document.createElement("span");l.textContent=label;d.append(b,l);$("report-metrics").append(d);}
function renderReport(){
 $("report-metrics").replaceChildren();show("performance",false);show("protocol-picker",false);
 if(!report){txt("report-status","公式集計が未取得です。");return;}
 txt("report-status","集計更新 "+stamp(report.created_at)+"（日本時間）");
 metric("固定保存",String(report.generated_frozen_count??"—")+"R");metric("確定評価",String(report.evaluated_races??"—")+"R");
 const all=Object.keys(report.protocols||{}).sort();if(!all.length){metric("採用判断","評価待ち");return;}
 const old=$("protocol").value;opts("protocol",all.map(k=>[k,k]),old||selected?.protocol_id);show("protocol-picker",true);
 const p=report.protocols[$("protocol").value];if(!p)return;
 metric("検証期間",String(p.elapsed_calendar_days)+"日");metric("検討条件",p.eligible_for_human_review?"到達":"未達");
 const fill=(id,summary)=>{$(id).replaceChildren();if(!summary)return;for(const [m,n] of methods){const r=summary[m];if(r)line($(id),[n,r.hit_races+"/"+r.purchased_races,yen(r.stake_yen),yen(r.payout_yen),pct(r.roi_percent)]);}};
 fill("cumulative-rows",p.summary);
 const daily=p.breakdown?.date?.[$("date").value.replace(/-/g,"")];fill("daily-rows",daily);txt("daily-empty",daily?"":"選択日の確定集計はまだありません。");
 $("robust-rows").replaceChildren();for(const n of ["1","3","5"]){const r=p.high_payout_exclusions?.[n];if(r)line($("robust-rows"),[n+"件",...methods.map(([m])=>pct(r[m]?.roi_percent))]);}
 txt("review-gate","評価 "+p.evaluated_races+"/200R ・ "+p.elapsed_calendar_days+"/28暦日。"+(p.eligible_for_human_review?"検討条件到達。明示的な採用判断が必要です。":"蓄積中。自動採用なし。"));
 show("performance",true);
}
function renderTickets(){
 if(!selected||!state)return;
 const list=tickets(selected,method,state),n=methods.find(x=>x[0]===method)[1];
 for(const b of $("method-tabs").children)b.setAttribute("aria-selected",String(b.dataset.method===method));
 txt("ticket-title",n+" の固定買い目");
 txt("ticket-info",list.length+"点 ・ 仮想合計 "+yen(sum(list))+" ・ 追加 "+list.filter(x=>x.added).length+"点");
 $("ticket-rows").replaceChildren();$("signal-rows").replaceChildren();
 for(const t of list){
  const origin=t.added?labelOrigin(t):"現行";
  const tr=line($("ticket-rows"),[[t.combo,"ticket "+(t.added?"added":"")],yen(t.yen),signed(t.delta),[origin+(t.hit?"・的中":""),t.hit?"hit":t.added?"added":""]]);
  if(t.hit)tr.setAttribute("aria-label",t.combo+" 的中");
  if(t.added)line($("signal-rows"),[[t.combo,"added"],Number.isFinite(t.teacher_pair_signal)?t.teacher_pair_signal.toFixed(4):"—",Number.isFinite(t.teacher_third_signal)?t.teacher_third_signal.toFixed(4):"—",origin]);
 }
 show("ticket-table",list.length>0);show("ticket-empty",!list.length);
 txt("ticket-empty",method==="E_capped_skip"?"固定記録：見送り（仮想購入0円）":"保存された買い目がありません。");
 txt("signal-empty",list.some(x=>x.added)?"":"この方式に追加買い目はありません。");
}
function renderRace(s,entry,r){
 selected=s;state=resultState(s,r,entry);
 txt("race-title",(entry?.venue_name||"場コード "+s.race_id.slice(8,10))+" "+Number(s.race_id.slice(-2))+"R");
 txt("race-state",state.status==="final"?"確定照合済":state.status==="excluded"?"評価対象外":Date.now()>=Date.parse(s.sales_close_at)?"締切済・結果待ち":"締切前固定済");
 txt("race-meta",s.field_size+"車 ・ "+s.race_class+" ・ 発走 "+clock(s.start_at)+" ・ 固定 "+clock(s.generated_at)+" JST");
 show("identity-warning",state.status==="excluded");txt("identity-warning",state.status==="excluded"?state.reason+"。固定予想は参考表示し、払戻は集計しません。":"");
 txt("race-result",state.status==="final"?"確定三連単（100円当たり）： "+Object.entries(state.payouts).map(([k,v])=>k+" "+yen(v)).join(" ／ "):state.reason);
 $("race-summary").replaceChildren();for(const [m,n] of methods){const t=s.methods[m],q=evaluate(t,state);line($("race-summary"),[n,t.length,yen(q.stake),[yen(q.pay),q.pay>0?"hit":""],[signed(q.net),q.net>0?"pos":q.net<0?"neg":""]]);}
 const reason={insufficient_pair_signal:"ペア選択スコアが基準未満",no_new_candidates:"追加候補なし",existing_ticket_count_exceeds_cap:"既存点数が上限を超過"};
 txt("gate","E方式："+(s.decision?.no_buy?"見送り（"+(reason[s.decision.no_buy_reason]||"固定記録の見送り条件") +"）":"仮想購入対象")+" ／ ペア選択スコア "+(Number.isFinite(s.signals?.max_pair_signal)?s.signals.max_pair_signal.toFixed(4):"—")+" ／ 閾値 "+(s.decision?.gate??"—"));
 txt("provenance","レースID "+s.race_id+" ／ 固定 "+stamp(s.generated_at)+" ／ 締切 "+stamp(s.sales_close_at)+" ／ 検証ID "+s.protocol_id+" ／ モデル "+s.model_id+" ／ 学習期限 "+(s.training?.training_through||"—"));
 $("snapshot-link").href=base+"snapshots/"+s.race_id+".json";show("race-panel",true);renderTickets();
 root.MrtOddsView?.render(s,entry);
}
async function loadRace(){
 root.MrtOddsView?.clear();
 const token=++version,id=$("race").value;selected=null;state=null;show("race-panel",false);
 if(!ids.includes(id)){txt("status","該当する固定予想はありません。");return;}
 txt("status","固定予想を読み込んでいます。");
 try{const s=validate(await get(base+"snapshots/"+id+".json"),id);if(token!==version)return;
 renderRace(s,dayRows.find(x=>x.race_id===id),dayResults.find(x=>x.race_id===id));
 txt("status",dayRows.filter(x=>x.race_id.slice(8,10)===$("venue").value).length+"件の固定予想（選択会場） ・ 生成 "+stamp(s.generated_at));
 renderReport();}catch(e){if(token===version)txt("status","固定予想を表示できません："+e.message);}
}
function chooseVenue(preferred){
 const v=$("venue").value;
 const list=dayRows.filter(x=>x.race_id.slice(8,10)===v).sort((a,b)=>a.race_id.localeCompare(b.race_id));
 opts("race",list.map(x=>[x.race_id,Number(x.race_id.slice(-2))+"R"+(x.start_at?" ・ "+clock(x.start_at):"")]),preferred);loadRace();
}
async function chooseDay(preferred){
 const token=++version,date=$("date").value,day=date.replace(/-/g,"");
 show("race-panel",false);$("venue").disabled=true;$("race").disabled=true;txt("status","開催情報と結果を取得中。");
 try{
  const [idx,res]=await Promise.all([get("data/mrt/"+date+"/index.json",true).catch(()=>null),get("data/mrt/"+date+"/results.json",true).catch(()=>null)]);
  if(token!==version)return;
  const rows=idx?.races||[];dayResults=res?.results||[];
  dayRows=ids.filter(id=>id.startsWith(day)).map(id=>rows.find(x=>x.race_id===id)||{race_id:id});
  const venues=new Map(dayRows.map(x=>[x.race_id.slice(8,10),x.venue_name||"場コード "+x.race_id.slice(8,10)]));
  opts("venue",[...venues].map(([v,n])=>[v,n]),preferred?.slice(8,10));
  renderReport();chooseVenue(preferred);
 }catch(e){if(token===version)txt("status",e.message);}
}
async function refresh(){
 const token=++version,old=$("race").value||deep;show("race-panel",false);$("refresh").disabled=true;
 for(const x of ["date","venue","race"])$(x).disabled=true;
 try{
  const [c,r]=await Promise.all([get(base+"view_index.json"),get(base+"latest.json",true).catch(()=>null)]);
  if(token!==version)return;ids=catalog(c);report=r?.schema==="tk-mrt-micro-forward-score/v1"?r:null;
  const dates=[...new Set(ids.map(id=>isoDate(id.slice(0,8))))].sort().reverse();
  opts("date",dates.map(x=>[x,x]),old?isoDate(old.slice(0,8)):$("date").value);
  deep=null;renderReport();
  if(!dates.length){txt("status","まだ締切前に固定された研究予想はありません。");return;}
  await chooseDay(old);
 }catch(e){if(token===version){txt("status","研究一覧を取得できません："+e.message+"。更新ボタンで再取得してください。");txt("report-status","集計の読み込みを確認してください。");}}
 finally{$("refresh").disabled=false;}
}
for(const [m,n] of methods){const b=document.createElement("button");b.textContent=n[0];b.title=n;b.dataset.method=m;b.type="button";b.setAttribute("role","tab");b.setAttribute("aria-controls","ticket-panel");b.setAttribute("aria-label",n);b.setAttribute("aria-selected",String(m===method));b.addEventListener("click",()=>{method=m;renderTickets();});$("method-tabs").append(b);}
$("refresh").addEventListener("click",refresh);$("date").addEventListener("change",()=>chooseDay());$("venue").addEventListener("change",()=>chooseVenue());$("race").addEventListener("change",loadRace);$("protocol").addEventListener("change",renderReport);
refresh();
})(typeof globalThis!=="undefined"?globalThis:this);
