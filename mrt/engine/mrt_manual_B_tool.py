"""Export V3 automatic and manual B-line options as a portable mobile HTML tool.
No fitting occurs. Historical demo uses the June evaluation model, not the full model.
"""
import argparse, copy, gzip, json, pathlib
import joblib
import mrt_logic_v3 as v3

def options(model,r,features=None,budget=10000):
 predict=lambda line=None,mode='leader': (v3.predict_input(model,r,budget,line,mode) if features is None else v3.infer(model,r,features,budget,line,mode))
 result={'race_id':r['race_id'],'date':r['date'],'lines':r['lines'],'names':r.get('names',{}),'budget_yen':budget,'automatic':predict(),'manual':{}}
 for line in r['lines']:
  key='-'.join(map(str,line));result['manual'][key]={mode:predict(line,mode) for mode in ['leader','members']}
 return result

TEMPLATE='''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mr.T研究 V3｜手動Bライン</title>
<style>*{box-sizing:border-box}body{margin:0;background:#101822;color:#edf2f7;font:16px/1.65 system-ui,sans-serif}main{max-width:740px;margin:auto;padding:24px 18px 48px}h1{font-size:25px;margin:8px 0}.tag{color:#6ee7c0;font-size:13px}section{background:#1c2837;padding:18px;border-radius:16px;margin:18px 0}label{display:block;margin:12px 0 5px}select,button,input{font:inherit;max-width:100%}select,button{width:100%;padding:12px;border-radius:10px;border:1px solid #62768e;background:#101822;color:inherit}button{background:#b6f3dc;color:#10251d;border:0;font-weight:bold;margin-top:15px;cursor:pointer}small,.muted{color:#b4c3d4;font-size:13px}.notice{border-left:3px solid #ffd68c;padding-left:12px}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{padding:10px 2px;border-bottom:1px solid #405065;text-align:right}th:first-child,td:first-child{text-align:left}.scenario{display:inline-block;padding:4px 10px;background:#31465d;border-radius:14px;margin:3px;font-size:13px}#status{color:#6ee7c0}textarea{width:100%;height:180px}details{margin-top:15px}</style>
<main><div class="tag">Mr.T研究 V3・追加オプション</div><h1>手動Bラインから買い目を生成</h1><p id="context" class="notice"></p><p class="muted">採用中のV3を使用。指定なしは従来の自動予測。手動指定は展開の仮定であり、そのラインがBを取る確率を100%と予測した意味ではありません。</p>
<section><label for="race">レース</label><select id="race"></select><p id="lineup"></p><label for="mode">予想モード</label><select id="mode"><option value="automatic">自動B予測</option><option value="manual">手動Bライン指定</option></select><div id="manual" hidden><label for="line">Bを取ると想定するライン</label><select id="line"></select><label for="rule">B取得者の扱い</label><select id="rule"><option value="leader">指定ラインの先頭車がBを取る</option><option value="members">指定ライン内でB取得者を自動配分</option></select><small>単騎も選択可。1着やライン独占は固定しません。</small></div><button id="generate">買い目を生成</button><p id="status" role="status"></p></section>
<section id="output" hidden aria-live="polite"><h2 style="font-size:20px" id="heading"></h2><div id="scenarios"></div><p id="commentary"></p><table><thead><tr><th>三連単</th><th>金額</th><th>B仮説</th></tr></thead><tbody id="tickets"></tbody><tfoot><tr><th>合計</th><th id="total"></th><th></th></tr></tfoot></table><button id="copy">買い目と解説をコピー</button><textarea id="fallback" hidden readonly aria-label="コピー用の買い目と解説"></textarea></section>
<details><summary>別レースのオプションデータを読み込む</summary><p class="muted">Pythonの同じエンジンで出力したJSONを選択。予算は出力時に設定します。</p><input id="import" type="file" accept=".json,application/json"></details><p class="muted">この画面は保存された各条件の計算結果を切り替えます。過去レースのデモは操作確認用です。手動指定での回収率は未検証。本番サイトとは独立しています。</p></main>
<script id="payload" type="application/json">__DATA__</script><script>
'use strict';let data=JSON.parse(document.getElementById('payload').textContent),shown=null;const el=id=>document.getElementById(id),yen=x=>x.toLocaleString('ja-JP')+'円';
function addOption(select,value,label){let o=document.createElement('option');o.value=value;o.textContent=label;select.append(o)}
function setup(){el('context').textContent=data.context;el('race').replaceChildren();data.races.forEach((r,i)=>addOption(el('race'),String(i),r.date+' / '+r.race_id));changeRace()}
function current(){return data.races[Number(el('race').value)]}
function invalidate(){shown=null;el('output').hidden=true;el('status').textContent='条件を選んで「買い目を生成」を押してください。'}
function changeRace(){let r=current();el('line').replaceChildren();r.lines.forEach(l=>addOption(el('line'),l.join('-'),l.join('―')));el('lineup').textContent='並び：'+r.lines.map(l=>l.join('―')).join(' ／ ')+'　予算：'+yen(r.budget_yen);invalidate()}
function generate(){let r=current(),isManual=el('mode').value==='manual';shown=isManual?r.manual[el('line').value][el('rule').value]:r.automatic;el('heading').textContent=isManual?'手動Bライン '+el('line').value+' の買い目':'自動B予測の買い目';el('commentary').textContent=shown.commentary;el('scenarios').replaceChildren();shown.scenarios.forEach(s=>{let span=document.createElement('span');span.className='scenario';span.textContent=s.proposed_B_holder+'番 B'+(isManual?'（指定条件）':'');el('scenarios').append(span)});el('tickets').replaceChildren();shown.tickets.forEach(t=>{let tr=document.createElement('tr');[t.cars.join('―'),yen(t.yen),t.scenario_id].forEach(v=>{let td=document.createElement('td');td.textContent=v;tr.append(td)});el('tickets').append(tr)});el('total').textContent=yen(shown.tickets.reduce((a,t)=>a+t.yen,0));el('fallback').hidden=true;el('output').hidden=false;el('status').textContent='選択した条件の買い目を表示しました。'}
el('generate').onclick=generate;el('race').onchange=changeRace;el('mode').onchange=()=>{el('manual').hidden=el('mode').value!=='manual';invalidate()};el('line').onchange=invalidate;el('rule').onchange=invalidate;
el('copy').onclick=async()=>{if(!shown)return;let text=shown.race_id+'\\n'+shown.commentary+'\\n'+shown.tickets.map(t=>t.cars.join('-')+' '+yen(t.yen)).join('\\n');try{await navigator.clipboard.writeText(text);el('status').textContent='コピーしました。'}catch(e){el('fallback').value=text;el('fallback').hidden=false;el('fallback').focus();el('fallback').select();el('status').textContent='表示欄からコピーしてください。'}};
el('import').onchange=async e=>{try{let candidate=JSON.parse(await e.target.files[0].text());if(candidate.schema!=='mrt-v3-manual-B-options-v1'||!Array.isArray(candidate.races)||!candidate.races.length)throw Error('形式が異なります');for(let r of candidate.races){if(!r.lines.length||!r.automatic.tickets.length)throw Error('買い目がありません');for(let l of r.lines)for(let mode of ['leader','members'])if(!r.manual[l.join('-')][mode].tickets.length)throw Error('ライン別データ不足')}data=candidate;setup()}catch(error){el('status').textContent='読み込み失敗：'+error.message}};setup();
</script></html>'''

def export(payload,destination):
 destination=pathlib.Path(destination);destination.write_text(TEMPLATE.replace('__DATA__',json.dumps(payload,ensure_ascii=False).replace('<','\\u003c')),encoding='utf-8')
 v3.dump(destination.with_suffix('.json'),payload)

def main():
 p=argparse.ArgumentParser();p.add_argument('--predict',required=True);p.add_argument('--model',default='mrt_logic_v3/serving_model.joblib');p.add_argument('--budget',type=int,default=10000);p.add_argument('--output',default='mrt_manual_B.html');a=p.parse_args()
 r=v3.v2.load(a.predict);model=joblib.load(a.model)
 payload={'schema':'mrt-v3-manual-B-options-v1','context':'入力データに基づく研究用予測。発走前の取得情報であることを別途確認してください。','races':[options(model,r,budget=a.budget)]}
 export(payload,a.output)
if __name__=='__main__':main()
