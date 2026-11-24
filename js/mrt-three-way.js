"use strict";
const base="data/mrt_research/mirror_fusion/",M=["MRT","MICRO","FUSION"],$=id=>document.getElementById(id);
const yen=v=>Number.isFinite(v)?v.toLocaleString("ja-JP")+"円":"未確定",pct=v=>Number.isFinite(v)?v.toFixed(2)+"%":"—",key=t=>t.cars.join("-");
let report=null,rows=[],method="FUSION",epoch=0;
function text(id,v){$(id).textContent=v}
function opts(id,a,want){const e=$(id);e.replaceChildren(...a.map(([v,l])=>{const o=document.createElement("option");o.value=v;o.textContent=l;return o}));e.disabled=!a.length;if(a.some(x=>x[0]===want))e.value=want}
function tr(id,v){const r=document.createElement("tr");for(const q of v){const d=document.createElement("td");d.textContent=Array.isArray(q)?q[0]:q;if(Array.isArray(q))d.className=q[1];r.append(d)}$(id).append(r)}
async function get(p){const r=await fetch(base+p,{cache:"no-store"});if(!r.ok)throw Error("研究データ未取得（"+r.status+"）");return r.json()}
function showRace(){const r=rows.find(x=>x.race_id===$("race").value);$("detail").hidden=!r;if(!r)return;text("title",r.venue+" "+r.race_no+"R");text("result",r.status==="final"?"確定："+Object.entries(r.payouts).map(([k,v])=>k+" "+yen(v)).join(" / "):r.status==="pending"?"締切前固定済・確定結果待ち":(r.reason||"三方式未揃い")+" ｜ "+M.map(m=>m+":"+(r.available?.[m]?"保存済":"未取得")).join(" "));
$("raceMetrics").replaceChildren();$("tickets").replaceChildren();text("timestamps","");
if(!r.tickets){text("ticketTitle","共通比較対象外");return}
for(const m of M){const pay=r.metrics?.[m]?.pay;tr("raceMetrics",[m,r.tickets[m].length,yen(10000),yen(pay),yen(Number.isFinite(pay)?pay-10000:null)])}
text("timestamps",M.map(m=>m+" 固定 "+new Date(r.generated[m]).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})).join(" ｜ "));
for(const b of $("tabs").children)b.setAttribute("aria-pressed",String(b.dataset.method===method));text("ticketTitle",method+" 固定買い目");
const a=new Map(r.tickets.MRT.map(t=>[key(t),t.yen]));
for(const t of r.tickets[method]){const k=key(t),hit=r.status==="final"&&Object.hasOwn(r.payouts,k);tr("tickets",[[k,hit?"hit":!a.has(k)?"add":""],yen(t.yen),String(t.yen-(a.get(k)||0)),({main:"主力",counter:"対抗",micro:"穴目"}[t.tier]||(!a.has(k)?"追加":"現行"))+(hit?"・的中":"")])}
}
function render(){const g=report?.groups?.[$("group").value];for(const id of ["summary","daily","teacher","robust"])$(id).replaceChildren();
if(!g){text("coverage","3方式の共通評価はまだありません。");return}
text("coverage","共通固定 "+g.paired+"R ／ 確定 "+g.final+"R ／ "+g.days+"/28暦日 ／ "+(g.eligible_review?"検討条件到達・承認必要":"研究蓄積中"));
const day=rows.filter(r=>r.group===$("group").value&&r.status==="final");
for(const m of M){const s=g.summary[m];tr("summary",[m,s.hits+"/"+s.races,yen(s.payout),pct(s.roi)]);const pay=day.reduce((a,r)=>a+r.metrics[m].pay,0);tr("daily",[m,day.filter(r=>r.metrics[m].pay>0).length+"/"+day.length,yen(pay),pct(day.length?pay/(100*day.length):null)]);tr("teacher",[m,s.teacher_races,pct(s.teacher_ticket_recall===null?null:100*s.teacher_ticket_recall),pct(s.teacher_stake_overlap===null?null:100*s.teacher_stake_overlap)])}
for(const n of ["7","9"])tr("robust",[n+"車",...M.map(m=>pct(g.by_size[n][m].roi))]);
for(const n of ["1","3","5"])tr("robust",["高額払戻"+n+"R除外",...M.map(m=>pct(g.exclude_top[n][m].roi))]);
}
async function day(){const token=++epoch;rows=[];$("detail").hidden=true;try{const d=await get("days/"+$("day").value+".json");if(token!==epoch)return;rows=d.races;opts("race",rows.map(r=>[r.race_id,r.venue+" "+r.race_no+"R"+(r.status==="final"?" 確定":r.status==="pending"?" 固定":" 対象外")]));showRace();render()}catch(e){if(token===epoch)text("status",e.message)}}
async function refresh(){try{report=await get("comparison.json");const days=report.days.slice().reverse();opts("day",days.map(d=>[d,d]),$("day").value);opts("group",Object.keys(report.groups).map((g,i)=>[g,"比較版 "+(i+1)+" · "+g.split(":")[2]+" / "+g.split(":")[3].slice(0,8)]),$("group").value);text("status","最終更新 "+new Date(report.updated_at).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"}));if(days.length)await day();else render()}catch(e){text("status",e.message+"。初回公開・固定データを確認してください。")}}
for(const m of M){const b=document.createElement("button");b.type="button";b.textContent=m;b.dataset.method=m;b.addEventListener("click",()=>{method=m;showRace()});$("tabs").append(b)}
$("day").addEventListener("change",day);$("race").addEventListener("change",showRace);$("group").addEventListener("change",render);$("refresh").addEventListener("click",refresh);refresh();
