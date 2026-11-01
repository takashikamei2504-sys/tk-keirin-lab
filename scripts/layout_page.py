"""Static layout transform. IDs and legacy handlers survive below a closed archive."""
import re,hashlib
from pathlib import Path

def section(text,id):
 marker=re.search(r'\bid="'+re.escape(id)+r'"',text)
 if not marker:raise ValueError('missing layout anchor '+id)
 start=text.rfind('<section',0,marker.start());depth=0
 for tag in re.finditer(r'</?section\b[^>]*>',text[start:]):
  depth+=-1 if tag.group().startswith('</') else 1
  if depth==0:return text[start:start+tag.end()]
 raise ValueError('unclosed section '+id)

def tidy(s):
 quick=section(s,'quick-race');causal=section(s,'causal-lab');recent=section(causal,'recent-form-panel')
 lines=section(s,'lines');players=section(s,'players')
 manual=quick[quick.index('<details class="quick-help">'):quick.rfind('</section>')]
 start=s.index('<body><div class="wrap">');scripts=s.index('<script src="js/race-brain.js')
 legacy=s[start+len('<body><div class="wrap">'):scripts]
 legacy=legacy[legacy.index(quick)+len(quick):]
 for part in (causal,lines,players):legacy=legacy.replace(part,'',1)
 # The original document closes .wrap immediately before its scripts.
 legacy=legacy.rstrip();assert legacy.endswith('</div>');legacy=legacy[:-6]
 head=s[:start].replace('</head>','<link rel="stylesheet" href="css/prediction-layout.css?v=layout-1">\n</head>')
 body='''<body><main class="wrap">
<header class="app-heading"><div><h1>TK KEIRIN LAB</h1><p class="sub">展開予想と、そこから選ぶ買い目</p></div><a href="riders.html">全S級データ</a></header>
<section class="panel quick-panel" id="quick-race" aria-label="レース選択">
<h2>レースを選ぶ</h2><div class="quick-grid"><label>開催日<input type="date" id="quick-date"></label><label>競輪場<select id="quick-venue"></select></label><label>レース<select id="quick-race-number"></select></label></div>
<button class="btn quick-main" id="quick-fetch" type="button">このレースの展開を予想する</button><p id="quick-status" class="quick-message" role="status"></p>
</section>
<section class="panel causal-panel" id="causal-lab" aria-label="展開予想と買い目">
<div class="prediction-head"><h2>展開予想</h2><button type="button" class="btn secondary" id="causal-run">再推理</button></div>
<p id="prediction-race" class="prediction-race"></p><p id="prediction-context" class="prediction-context"></p>
<div id="causal-stories"></div>
<div class="ticket-section-heading"><h3>展開から選ぶ３連単10点</h3><button type="button" class="btn" id="causal-copy">10点をコピー</button></div>
<p class="small" id="ticket-display-count"></p><p class="small">1・2着が同じ買い目をまとめています。例：1-2-345＝3点。「展開・採用理由」から元の展開へ戻れます。</p><div class="causal-tickets" id="causal-tickets"></div>
<p id="prediction-feedback" class="prediction-feedback" role="status"></p><p class="prediction-note">未校正の展開仮説です。初期表示は参考サンプル。的中確率を示すものではありません。</p>
</section>
<h2 class="support-heading">参考情報・詳細</h2>
<details class="panel support-disclosure" id="evaluation-details"><summary>レース結果・予想の評価と改善</summary>
<h3>発走前に保存した共通予想の成績</h3><p id="evaluation-status" role="status"></p><p id="evaluation-summary"></p><p id="evaluation-paired" class="small"></p>
<div class="quick-smallrow"><button type="button" class="btn secondary" id="evaluation-update">結果を更新</button><button type="button" class="btn secondary" id="evaluation-export">評価記録をJSON保存</button></div>
<p class="small">共通予想はGitHubで自動保存。この端末では発走前に最後に表示した予想も自動保存します。公開配信の着順・同着・払戻を照合し、事前記録のない過去レースは成績に入れません。払戻表示は実際の購入収支ではありません。</p>
<p id="evaluation-storage" class="small"></p><p id="evaluation-device" class="small"></p>
<h3>改善の候補</h3><div id="evaluation-improvements"></div><p class="small">着順だけで実際の攻防を確定せず、候補漏れを分類して改善に使います。モデル係数・選手特性の自動書換えは行いません。</p>
<label>結果の日付<select id="evaluation-date"><option value="all">全日</option></select></label><div id="evaluation-races"></div><p id="evaluation-limit" class="small"></p></details>
<details class="panel support-disclosure" id="race-data-details"><summary>出走選手・想定並び・近況成績</summary>'''+lines+players+recent+'''</details>
<details class="panel support-disclosure" id="keymen-details"><summary>レースを動かすキーマン</summary><div class="causal-grid" id="causal-top"></div><div id="causal-keymen"></div></details>
<details class="panel support-disclosure" id="article-details"><summary>選手特性・記事の根拠</summary><div id="auto-intel-status" class="causal-meta" role="status">記事データを取得中…</div><div id="auto-intel-evidence"></div></details>
<details class="panel support-disclosure" id="collection-details"><summary>取得状況・出典・予想の保存</summary><div id="causal-state" class="causal-meta" role="status"></div><p id="quick-status-detail" class="aux-status"></p><p id="quick-data-info" class="small"></p><p class="small">出走表配信元：<a href="https://github.com/kurinaka12-afk/keirin-app-data" target="_blank" rel="noopener noreferrer">keirin-app-data</a>。近況成績はKEIRIN.JPの公開プロフィールから取得。未取得項目や発走後に取得した情報は実績として補完しません。</p><button type="button" class="btn secondary" id="causal-export">展開と買い目をJSON保存</button><div class="support-links"><a href="riders.html">全S級の収集状況</a><a href="v12.html">従来のv1.2</a><a href="v13.html">元のv1.3</a></div></details>
<details class="panel support-disclosure" id="manual-input-details"><summary>出走表を手元のデータから取り込む</summary>'''+manual+'''</details>
<details class="panel support-disclosure" id="research-archive"><summary>旧モデル・研究用の画面</summary><p class="small">以前の試作・比較機能です。上の展開予想と買い目は、独立したエンジンで生成しています。</p>'''+legacy+'''</details>
</main>'''
 tail=s[scripts:].replace('<script src="js/recent-form-ui.js?v=all-s-1"></script>','<script src="js/recent-form-ui.js?v=all-s-1"></script><script src="js/prediction-view.js?v=layout-1"></script>',1)
 a=tail.index('  const stories=out.hypotheses.map');b=tail.index('  return out;',a)
 tail=tail[:a]+'  PredictionView.render(out,data);ResultsUI.track(out,data);\n'+tail[b:]
 tail=tail.replace("$('causal-state').textContent+='\\n買い目をコピーしました。';", "$('prediction-feedback').textContent=causalLast.chosen.length+'点をコピーしました。';")
 a=tail.index(' const s=`${causalLast.race.date}')
 b=tail.index('\n try{await navigator.clipboard',a)
 tail=tail[:a]+' const s=PredictionView.copyText(causalLast);'+tail[b:]
 tail=tail.replace("}catch(e){$('causal-state').textContent='展開推理のエラー：'+e.message;", "}catch(e){$('prediction-feedback').textContent='展開予想を生成できませんでした：'+e.message;$('causal-stories').innerHTML='';$('causal-tickets').innerHTML='';$('causal-state').textContent='展開推理のエラー：'+e.message;")
 old="function quickStatus(s,kind=''){$('quick-status').textContent=s;$('quick-status').className='quick-message '+kind;}"
 new="function quickStatus(s,kind=''){$('quick-status').textContent=String(s).split('\\n')[0];$('quick-status-detail').textContent=s;$('quick-status').className='quick-message '+kind;}"
 assert old in tail;tail=tail.replace(old,new)
 tail=tail.replace("$('header').scrollIntoView", "$('causal-lab').scrollIntoView")
 digest=hashlib.sha256((Path(__file__).resolve().parents[1]/'js/results-ui.js').read_bytes()).hexdigest()[:12]
 tail=tail.replace('<script src="js/prediction-view.js?v=layout-1"></script>','<script src="js/prediction-view.js?v=layout-1"></script><script src="js/results-ui.js?v='+digest+'"></script>',1)
 result=head+'\n'.join(line.rstrip() for line in body.splitlines())+'\n'+tail
 for asset in ('css/prediction-layout.css','js/prediction-view.js'):
  digest=hashlib.sha256((Path(__file__).resolve().parents[1]/asset).read_bytes()).hexdigest()[:12]
  result=result.replace(asset+'?v=layout-1',asset+'?v='+digest)
 return result
