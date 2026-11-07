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

audit().catch(error => {element('performance').textContent = error.message;});
