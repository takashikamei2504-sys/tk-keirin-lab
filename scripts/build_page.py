#!/usr/bin/env python3
"""Reproducible integration of supplied v1.3 UI with independent brain."""
from pathlib import Path
root=Path(__file__).resolve().parents[1]
s=(root/'v13.html').read_text()
start=s.index('/* TK KEIRIN LAB v1.3 - explicit causal-state event branching.')
ui=s.index('function causalRun(){',start)
s=s[:start]+"const CAUSAL_V=RaceBrain.VERSION; let causalLast=null; const causalEsc=x=>esc(x); let autoIntelPack={};\nfunction causalBuild(r){validate(r);const enriched=RecentForm.attach(r,recentFormPack);const out=RaceBrain.build(enriched,autoIntelPack);out.form={riders:enriched.riders.map(x=>({no:x.no,name:x.name,recent_form:x.recent_form,form_status:x.form_status})),status:enriched.recent_form_status};return out;}\n"+s[ui:]
s=s.replace('<script>','<script src="js/race-brain.js?v=decisions-1"></script><script src="js/recent-form.js?v=recent-2"></script><script src="js/recent-form-ui.js?v=all-s-1"></script><script>',1)
s=s.replace('v1.3','v1.4')
s=s.replace('font-weight:500">v1.2</span></h1>', 'font-weight:500">v1.4</span></h1>')
s=s.replace('CAUSAL RACE BRAIN / v1.4','INDEPENDENT RACE BRAIN / v1.4')
s=s.replace('出走表・ライン・競走得点と、保存済みの人物仮説から推理します。現状の個性は未検証の推定を含みます。記事本文の自動読解と学習済み確率モデルはまだ接続していません。未提供のB/S・直近着数は、取得した実績として扱いません。','公開記事本文の自動抽出と脚質・得点から独立推理。従来の印・買い目・手入力の人物仮説は使いません。記事不足時は暫定値で生成し、未校正の仮説スコアとして表示します。')
s=s.replace(' <div id="causal-state"', ' <div class="quick-smallrow"><a class="btn secondary" href="riders.html">全S級選手データ</a><a class="btn secondary" href="v12.html">従来のv1.2を開く</a><a class="btn secondary" href="v13.html">元のv1.3</a></div>\n <div id="auto-intel-status" class="causal-meta" role="status">記事データを自動取得中…</div>\n <details class="causal-story"><summary>選手別の記事根拠・情報不足を確認</summary><div id="auto-intel-evidence"></div></details>\n <div id="causal-state"',1)
s=s.replace('<section class="panel" id="intel-panel">','<details class="panel"><summary>従来の研究台帳（独立エンジンでは使用しません）</summary><section id="intel-panel">')
pos=s.index('<details class="panel"><summary>従来の研究台帳')
end=s.index('</section>',pos)
s=s[:end]+s[end:].replace('</section>','</section></details>',1)
s=s.replace("const out=causalBuild(data);causalLast=out;","const out=causalBuild(data);causalLast=out;autoIntelRender(out);")
s=s.replace("'B/S・直近成績は未提供（人物仮説の推定値で補助）'","'B/S・直近成績は未提供（欠損として処理）'")
s=s.replace("const o={schema:'tk-keirin-causal/v1.4',generated_at:new Date().toISOString(),...causalLast};","const o={schema:'tk-keirin-causal/v1.4',generated_at:new Date().toISOString(),version:CAUSAL_V,race:causalLast.race,keymen:causalLast.keymen,intelligence:causalLast.intelligence,profiles:causalLast.profiles,recent_form:causalLast.form,rating:causalLast.rating,chosen:causalLast.chosen.map(t=>({...t,paths:t.paths.slice(0,3)}))};")
s=s.replace('causalRun();\n\n</script>', '''causalRun();
async function autoIntelLoad(){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),10000);
 try{
  let res;
  try{res=await fetch('https://raw.githubusercontent.com/takashikamei2504-sys/tk-keirin-lab/main/data/intelligence.json',{cache:'no-cache',signal:ctrl.signal});}catch(_){}
  if(!res?.ok)res=await fetch('data/intelligence.json',{cache:'no-cache'});
  if(!res.ok)throw Error('HTTP '+res.status);
  const pack=await res.json();
  if(pack.schema!=='tk-keirin-intelligence/v1.4'||!Array.isArray(pack.evidence)||pack.evidence.length>50000)throw Error('記事データ形式が不正です');
  autoIntelPack=pack;causalRun();
 }catch(e){$('auto-intel-status').textContent='記事データ取得不可：'+e.message+'。脚質・得点の暫定値で生成しています。再読込で再取得します。';}
 finally{clearTimeout(timer)}
}
function autoIntelRender(out){
 const total=data.riders.length,covered=Object.values(out.profiles).filter(p=>p.evidence.length).length;
 const generated=autoIntelPack.generated_at?new Date(autoIntelPack.generated_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}):'未取得';
 const errors=autoIntelPack.status?.errors?.length||0;
 $('auto-intel-status').textContent=`記事自動分析：${covered}/${total}選手に本文根拠。適用${out.intelligence.evidence_count}件。最終収集 ${generated}（日本時間）。${errors?'収集時の未取得・日付不明等 '+errors+'件。':''}記事公開・初回取得が発走より前の情報だけ適用。未校正のルール推理です。`;
 $('auto-intel-evidence').innerHTML=data.riders.map(x=>{
  const p=out.profiles[x.no],es=p.evidence.slice(0,6);
  return `<div class="intel-record"><strong>${x.no}番 ${esc(x.name)}</strong><p>${esc(p.basis)}${!es.length?'／このレースの発走前に利用可能な記事根拠なし':''}</p>`+es.map(e=>`<p><a target="_blank" rel="noopener noreferrer" href="${esc(e.url)}">${esc(e.title||'公開記事')}</a>：${esc(BRAIN_TRAITS[e.trait]||e.trait)}<br>${esc(e.excerpt||'')}<br><small>公開 ${esc(e.published_at)}／取得 ${esc(e.collected_at)}</small></p>`).join('')+'</div>';
 }).join('');
}
autoIntelLoad();
</script>''')
# Show broad tactical hypotheses and the actual path supporting each selected ticket.
a=s.index('  const seen=new Set(),stories=[];')
b=s.index("  $('causal-stories').innerHTML",a)
s=s[:a]+"  const stories=out.hypotheses.map(h=>h.representative);\n"+s[b:]
a=s.index("  $('causal-stories').innerHTML")
b=s.index('  return out;',a)
s=s[:a]+r'''  $('causal-stories').innerHTML=stories.map((n,i)=>`<details class="causal-story" ${i===0?'open':''}><summary><strong>${i+1}. ${n.key}</strong>　${causalEsc(RaceBrain.MODES[n.mode])}</summary><p class="small">同じ局面の着順候補をまとめた展開仮説</p><ol>${n.states.map(v=>`<li>${causalEsc(v)}</li>`).join('')}</ol><p class="hyp">${causalEsc(n.explanation)}（仮説スコア。確率ではない）</p><details class="decision-reasons"><summary>この局面での判断根拠</summary>${n.decisions.map(d=>`<p class="small"><strong>${d.no}番 ${causalEsc(d.name)}</strong>：${causalEsc(d.context)}<br>${causalEsc(d.basis)}${d.measurements.length?'<br>'+causalEsc(d.measurements.join(' ／ ')):''}</p>`).join('')}<p class="small">Bと3連対率は追走力・前受けの実測値ではありません。記事不足の判断は暫定値です。</p></details></details>`).join('');
  $('causal-tickets').innerHTML=out.chosen.map((t,i)=>{const p=t.supporting_path;return `<div class="causal-ticket"><strong>${i+1}. ${causalEsc(t.key)}</strong><span>${causalEsc(RaceBrain.MODES[p.mode])}${t.selection_reason.includes('別筋を確保')?' ✦ 別筋枠':''}</span><details class="ticket-reason"><summary>採用理由</summary><p class="small">${causalEsc(t.selection_reason)}</p><p class="small">${causalEsc(p.explanation)}</p><p class="small">${t.paths.length}通りの決着経路を集約。未校正の仮説スコアで選定。</p></details></div>`;}).join('');
'''+s[b:]
s=s.replace('profiles:causalLast.profiles,recent_form:', 'profiles:causalLast.profiles,hypotheses:causalLast.hypotheses,recent_form:')
s=s.replace("${esc(p.basis)}${!es.length?", "${esc(p.basis)}${p.form_basis?'<br>'+esc(p.form_basis):''}${p.measurements.length?'<br>'+esc(p.measurements.join(' ／ ')):''}${!es.length?")

# Recent form is a separate automatic feed, preserving the supplied v1.3 and v1.2.
s=s.replace(' <div id="causal-state"', '<section class="intel-box" id="recent-form-panel"><h3>自動収集した近況成績</h3><p class="causal-meta" role="status" id="recent-form-status">近況成績を自動取得中…</p><div id="recent-form-riders"></div></section>\n <div id="causal-state"',1)
s=s.replace('causalLast=out;autoIntelRender(out);','causalLast=out;autoIntelRender(out);recentFormRender(out);')
s=s.replace('B/S・直近成績は未提供（欠損として処理）','一部データは未取得（近況の取得状況は上欄）')
s=s.replace('autoIntelLoad();\n</script>','autoIntelLoad();recentFormLoad();\n</script>')
# Hoisted autoIntelRender is available when initial causalRun executes.
(root/'v14.html').write_text(s)
# index.html is the independent app entrance; rebuilding predictions preserves it.
