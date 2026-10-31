#!/usr/bin/env python3
"""Reproducible integration of supplied v1.3 UI with independent brain."""
from pathlib import Path
root=Path(__file__).resolve().parents[1]
s=(root/'v13.html').read_text()
start=s.index('/* TK KEIRIN LAB v1.3 - explicit causal-state event branching.')
ui=s.index('function causalRun(){',start)
s=s[:start]+"const CAUSAL_V=RaceBrain.VERSION; let causalLast=null; const causalEsc=x=>esc(x); let autoIntelPack={};\nfunction causalBuild(r){validate(r);return RaceBrain.build(r,autoIntelPack);}\n"+s[ui:]
s=s.replace('<script>','<script src="js/race-brain.js"></script><script>',1)
s=s.replace('v1.3','v1.4')
s=s.replace('CAUSAL RACE BRAIN / v1.4','INDEPENDENT RACE BRAIN / v1.4')
s=s.replace('出走表・ライン・競走得点と、保存済みの人物仮説から推理します。現状の個性は未検証の推定を含みます。記事本文の自動読解と学習済み確率モデルはまだ接続していません。未提供のB/S・直近着数は、取得した実績として扱いません。','公開記事本文の自動抽出と脚質・得点から独立推理。従来の印・買い目・手入力の人物仮説は使いません。記事不足時は暫定値で生成し、未校正の仮説スコアとして表示します。')
s=s.replace(' <div id="causal-state"', ' <div class="quick-smallrow"><a class="btn secondary" href="v12.html">従来のv1.2を開く</a><a class="btn secondary" href="v13.html">元のv1.3</a></div>\n <div id="auto-intel-status" class="causal-meta" role="status">記事データを自動取得中…</div>\n <details class="causal-story"><summary>選手別の記事根拠・情報不足を確認</summary><div id="auto-intel-evidence"></div></details>\n <div id="causal-state"',1)
s=s.replace('<section class="panel" id="intel-panel">','<details class="panel"><summary>従来の研究台帳（独立エンジンでは使用しません）</summary><section id="intel-panel">')
pos=s.index('<details class="panel"><summary>従来の研究台帳')
end=s.index('</section>',pos)
s=s[:end]+s[end:].replace('</section>','</section></details>',1)
s=s.replace("const out=causalBuild(data);causalLast=out;","const out=causalBuild(data);causalLast=out;autoIntelRender(out);")
s=s.replace("'B/S・直近成績は未提供（人物仮説の推定値で補助）'","'B/S・直近成績は未提供（欠損として処理）'")
s=s.replace("const o={schema:'tk-keirin-causal/v1.4',generated_at:new Date().toISOString(),...causalLast};","const o={schema:'tk-keirin-causal/v1.4',generated_at:new Date().toISOString(),version:CAUSAL_V,race:causalLast.race,keymen:causalLast.keymen,intelligence:causalLast.intelligence,profiles:causalLast.profiles,rating:causalLast.rating,chosen:causalLast.chosen.map(t=>({...t,paths:t.paths.slice(0,3)}))};")
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
# Hoisted autoIntelRender is available when initial causalRun executes.
(root/'v14.html').write_text(s)
# Preserve the prior landing page before promoting the new brain.
if not (root/'v02.html').exists(): (root/'v02.html').write_bytes((root/'index.html').read_bytes())
(root/'index.html').write_text('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=v14.html"><title>TK KEIRIN LAB</title><p><a href="v14.html">TK KEIRIN LAB v1.4を開く</a></p><p><a href="v12.html">従来のv1.2</a></p></html>')
