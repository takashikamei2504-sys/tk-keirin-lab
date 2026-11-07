'use strict';

const element = id => document.getElementById(id);
const node = (tag, value) => {
  const result = document.createElement(tag);
  if (value !== undefined) result.textContent = value;
  return result;
};
const pct = value => value == null ? '—' : (100 * value).toFixed(1) + '%';
const yen = value => value == null ? '—' : value.toLocaleString('ja-JP') + '円';
const list = rows => {
  const dl = node('dl');
  for (const [label, value] of rows) dl.append(node('dt', label), node('dd', value));
  return dl;
};
const statistics = row => list([
  ['回収率', pct(row.roi)], ['収支', yen(row.net)], ['購入額', yen(row.stake)], ['払戻額', yen(row.payout)],
  ['評価／購入レース', row.evaluated + '／' + row.purchased], ['レース的中', row.hits + '（' + pct(row.hit_rate) + '）'],
  ['買い目／的中票', row.tickets + '／' + row.winning_tickets], ['返還票', row.refunded_tickets],
  ['平均購入点数', row.avg_points?.toFixed(2) ?? '—'], ['1着捕捉', pct(row.first_capture)],
  ['1・2着捕捉', pct(row.pair_capture)], ['最大ドローダウン', yen(row.max_drawdown)],
  ['最大／現在連敗', row.max_losing_streak + '／' + row.current_losing_streak],
  ['上位1件除外', pct(row.trimmed[1])], ['上位3件除外', pct(row.trimmed[3])], ['上位5件除外', pct(row.trimmed[5])], ['最高払戻レース除外', pct(row.without_top_race)]
]);

async function audit() {
  const response = await fetch('data/roi/audit.json', {cache:'no-cache'});
  if (!response.ok) throw Error('収支データを読み込めませんでした。');
  const data = await response.json();
  const models = new Map();
  const selector = element('model');
  function add(label, value) {
    const option = node('option', label);
    option.value = String(models.size);
    models.set(option.value, value);
    selector.append(option);
  }
  if (data.lab.by_model[data.current_lab_model]) add('現行LAB｜' + data.current_lab_model, data.lab.by_model[data.current_lab_model]);
  add('LAB｜各レース最新保存', data.lab.latest);
  add('LINE｜各レース最新保存（複数版）', data.line.latest);
  for (const [model, row] of Object.entries({...data.lab.by_model, ...data.line.by_model})) {
    if (model !== data.current_lab_model) add(model, row);
  }
  const dimension = element('dimension');
  function render() {
    const row = models.get(selector.value);
    const details = node('details');
    details.append(node('summary', '内訳を開く'));
    const key = dimension.value;
    const groups = key === 'payout_bands' ? row.payout_bands : row.breakdown[key];
    for (const [label, group] of Object.entries(groups).sort(([a], [b]) => key === 'date' ? b.localeCompare(a) : a.localeCompare(b,'ja'))) {
      const article = node('article');
      article.append(node('h3', label), key === 'payout_bands' ? list([
        ['レース数', group.races], ['回収率', pct(group.roi)], ['購入額', yen(group.stake)], ['払戻額', yen(group.payout)]
      ]) : list([['評価レース',group.evaluated],['回収率',pct(group.roi)],['購入額',yen(group.stake)],
        ['払戻額',yen(group.payout)],['的中率',pct(group.hit_rate)],['最大ドローダウン',yen(group.max_drawdown)]]));
      details.append(article);
    }
    element('performance').replaceChildren(statistics(row),
      node('p', '結果待ち ' + (row.statuses.pending || 0) + 'R／照合除外 ' +
        Object.entries(row.statuses).filter(([status]) => !['pending','evaluated'].includes(status)).reduce((n,[,v]) => n+v,0) + 'R'), details);
  }
  selector.addEventListener('change', render);
  dimension.addEventListener('change', render);
  render();
  const paired = data.comparison;
  element('comparison').replaceChildren(node('h3','LAB・LINEの共通 ' + paired.races + 'R（各レース最新保存）'),
    list([['LAB回収率',pct(paired.base.roi)],['LINE回収率',pct(paired.candidate.roi)],
      ['LAB上位1件除外',pct(paired.base_trimmed[1])],['LINE上位1件除外',pct(paired.candidate_trimmed[1])],
      ['LAB損益',yen(paired.base.net)],['LINE損益',yen(paired.candidate.net)]]));
}

audit().then(research).catch(error => {element('performance').textContent = error.message;});

const todayJst = () => new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const raceLabel = race => race.date + '　' + race.venue + race.number + 'R　' + race.start;

async function live() {
  const date = todayJst();
  const dir = 'data/roi/forecasts/' + date + '/';
  const response = await fetch(dir + 'index.json', {cache:'no-cache'});
  if (response.status === 404) return;
  if (!response.ok) throw Error('本日の予想を読み込めませんでした。');
  const data = await response.json();
  const rows = data.rows.filter(r => r.model === data.model && Date.parse(r.cutoff) > Date.now());
  if (!rows.length) {
    element('today').textContent = '本日の発走前の配信はありません。';
    return;
  }
  const selector = node('select');
  selector.setAttribute('aria-label','展開を確認するレース');
  rows.forEach((r,i) => {
    const option = node('option',raceLabel(r.race));
    option.value = String(i);
    selector.append(option);
  });
  const detail = node('div'), stories = element('stories');
  element('today').replaceChildren(selector, detail);
  let revision = 0;
  async function render() {
    const current = ++revision;
    const row = rows[Number(selector.value)];
    const purchase = row.decision.tickets || [];
    const buyKeys = purchase.map(t=>t.key);
    const keys = buyKeys.length ? buyKeys : row.candidates;
    detail.replaceChildren(node('p',buyKeys.length ? '期待値の研究候補' : '購入判断　見送り'));
    if (keys.length) {
      detail.append(node('p',buyKeys.length ? '選別した買い目' : '展開に基づく研究候補'),node('output',keys.join('、')));
      const copy = node('button','買い目をコピー');
      copy.type = 'button';
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(keys.join('\n'));
          copy.textContent = 'コピーしました';
        } catch {
          const input = node('textarea');
          input.value = keys.join('\n');
          input.readOnly = true;
          detail.append(input);
          input.select();
        }
      };
      detail.append(copy);
    }
    for (const t of purchase) {
      if (Number.isFinite(t.probability) && Number.isFinite(t.odds) && Number.isFinite(t.ev)) {
        detail.append(list([[t.key,pct(t.probability)],['取得オッズ',t.odds+'倍'],['期待値',t.ev.toFixed(2)]]));
      }
    }
    stories.textContent = '展開を読み込んでいます。';
    if (!/^[a-f0-9]{64}\.json$/.test(row.file)) return;
    const result = await fetch(dir + row.file);
    if (!result.ok) throw Error('展開を読み込めませんでした。');
    const forecast = await result.json();
    if (current !== revision) return;
    const panels = [];
    const labBack = forecast.stories.LAB.main?.scenes[3]?.order;
    const lineBack = forecast.stories.LINE.main?.scenes[3]?.order;
    if (labBack && lineBack) panels.push(node('p', '最終バックの先頭　LAB ' + labBack[0] + '番／LINE ' + lineBack[0] + '番'));
    for (const [name,story] of Object.entries(forecast.stories)) {
      if (!story.main) continue;
      const panel = node('details');
      panel.append(node('summary',name + '｜' + story.main.axis),node('p',story.main.title));
      if (story.main.reason) panel.append(node('p',story.main.reason));
      const phases = node('ol');
      for (const scene of story.main.scenes) phases.append(node('li',
        scene.phase + '　' + (scene.order || []).join('→') + '　' + scene.text));
      panel.append(phases);
      panels.push(panel);
    }
    stories.replaceChildren(...panels);
  }
  const refresh = () => render().catch(error=>{stories.textContent=error.message;});
  selector.addEventListener('change',refresh);
  await refresh();
}

async function research() {
  const response = await fetch('data/roi/research.json',{cache:'no-cache'});
  if (!response.ok) return;
  const data = await response.json();
  const panel = node('details');
  panel.append(node('summary','統合候補の時系列比較'));
  const labels = {lab:'現行LAB',line:'LINE',line10:'LINE 上限10点',
    integrated_rank:'統合スコア順',integrated_coverage:'統合・展開分散'};
  for (const [key,title] of [['development','開発期間'],['holdout',data.holdout_from+' 以降の検証期間']]) {
    panel.append(node('h3',title));
    for (const [name,row] of Object.entries(data[key])) {
      const article = node('article');
      article.append(node('h3',labels[name]),list([['評価レース',row.evaluated],['回収率',pct(row.roi)],
        ['収支',yen(row.net)],['1着捕捉',pct(row.first_capture)],['1・2着捕捉',pct(row.pair_capture)],
        ['的中率',pct(row.hit_rate)],['平均点数',row.avg_points?.toFixed(2) ?? '—'],
        ['最大ドローダウン',yen(row.max_drawdown)],['上位5件除外',pct(row.trimmed[5])]]));
      panel.append(article);
    }
  }
  element('comparison').append(panel);
}

live().catch(error=>{element('today').textContent=error.message;});
