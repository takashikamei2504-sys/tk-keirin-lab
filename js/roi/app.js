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
  element('comparison').prepend(node('h3','LAB・LINEの共通 ' + paired.races + 'R（各レース最新保存）'),
    list([['LAB回収率',pct(paired.base.roi)],['LINE回収率',pct(paired.candidate.roi)],
      ['LAB上位1件除外',pct(paired.base_trimmed[1])],['LINE上位1件除外',pct(paired.candidate_trimmed[1])],
      ['LAB損益',yen(paired.base.net)],['LINE損益',yen(paired.candidate.net)]]));
}

audit().catch(error => {element('performance').textContent = error.message;});
research().catch(() => {});
const prospectiveReport = fetch('data/roi/prospective.json',{cache:'no-cache'})
  .then(response => response.ok ? response.json() : null).catch(() => null);
prospectiveReport.then(showTrials).catch(() => {
  element('trial-summary').textContent = '検証結果を読み込めませんでした。';
});
validation(prospectiveReport).catch(() => {
  element('validation').textContent = '検証の詳細を読み込めませんでした。';
});

const todayJst = () => new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const raceLabel = race => race.date + '　' + race.venue + race.number + 'R　' + race.start;

async function live() {
  const date = todayJst();
  const dir = 'data/roi/forecasts/' + date + '/';
  const response = await fetch(dir + 'index.json', {cache:'no-cache'});
  if (response.status === 404) return noRaces();
  if (!response.ok) throw Error('本日の予想を読み込めませんでした。');
  const data = await response.json();
  const rows = data.rows.filter(r => r.model === data.model && Date.parse(r.cutoff) > Date.now());
  if (!rows.length) return noRaces();
  const selector = node('select');
  selector.id = 'race-select';
  rows.forEach((r,i) => {
    const option = node('option',raceLabel(r.race));
    option.value = String(i);
    selector.append(option);
  });
  const status = node('div'), detail = node('div'), stories = element('stories');
  const label = node('label','レースを選ぶ');
  label.htmlFor = selector.id;
  element('today').replaceChildren(status, label, selector, detail);
  let revision = 0;
  async function render() {
    const current = ++revision;
    const row = rows[Number(selector.value)];
    const purchase = row.decision.tickets || [];
    const buyKeys = purchase.map(t=>t.key);
    const keys = buyKeys.length ? buyKeys : row.candidates;
    const verdict = node('p',buyKeys.length ? '期待値の研究候補あり' : '購入判断　見送り');
    verdict.className = 'verdict';
    verdict.setAttribute('role','status');
    const reason = {calibration:'的中確率を検証中です。',odds:'発走前オッズの取得待ちです。',
      uncertainty:'確率のばらつきを検証中です。',no_edge:'購入基準を満たす候補がありません。'};
    status.replaceChildren(verdict);
    detail.replaceChildren();
    if (!buyKeys.length) status.append(node('p',reason[row.decision.reason] || '購入条件を確認中です。'));
    const research = node('details');
    if (keys.length) {
      research.append(node('summary','研究候補の買い目を見る'),node('output',keys.join('、')));
      const copy = node('button','研究候補をコピー');
      copy.type = 'button';
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(keys.join('\n'));
          copy.textContent = 'コピーしました';
        } catch {
          const input = node('textarea');
          input.value = keys.join('\n');
          input.readOnly = true;
          research.append(input);
          input.select();
        }
      };
      research.append(copy);
      detail.append(research);
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
    if (forecast.shadow) {
      const trial = node('details');
      trial.append(node('summary','このレースの追加1点を見る'),list([
        ['基準の上位4点',forecast.shadow.core.join('、')],
        ['本線の追加1点',forecast.shadow.main || '候補なし'],
        ['別線2着・展開の裏づけあり',forecast.shadow.mixed.ticket || '候補なし'],
        ['別線2着・並びと得点から',forecast.shadow.mixed.reference || '候補なし']
      ]));
      detail.append(trial);
    }
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

function noRaces(message = '本日の発走前の配信はありません。') {
  element('today').textContent = message;
  element('race-stories').hidden = true;
}
live().catch(error=>noRaces(error.message));

function shadowReport(model, report) {
  const panel = node('details');
  panel.append(node('summary','追加1点の比較｜'+model),
    node('p','結果待ち '+report.pending+'R／混合の展開条件に該当 '+(report.gates.supported || 0)+'R'));
  const stats = (title,row) => list([[title,row.races+'R'],['的中',row.hits],['回収率',pct(row.roi)],
    ['購入額',yen(row.stake)],['払戻額',yen(row.payout)],['収支',yen(row.net)],
    ['最高払戻除外',pct(row.trimmed[1])],['上位5件除外',pct(row.trimmed[5])],
    ['最大ドローダウン',yen(row.max_drawdown)]]);
  panel.append(node('h3','全対象と追加1点単独'),stats('現行LAB全点',report.all.full),
    stats('LAB上位4点',report.all.core),stats('本線追加1点',report.all.main),stats('混合追加1点',report.all.mixed));
  const paired = report.paired;
  panel.append(node('h3','両方の追加1点が揃った共通 '+paired.core.races+'R'));
  if (paired.core.races) {
    panel.append(stats('上位4点＋本線',paired.coreMain),stats('上位4点＋混合',paired.coreMixed),
      stats('本線の追加分のみ',paired.main),stats('混合の追加分のみ',paired.mixed));
  }
  const reference = report.reference_paired;
  if (reference) {
    panel.append(node('h3','並びと得点のみの参考比較｜共通 '+reference.core.races+'R'));
    if (reference.core.races) panel.append(stats('上位4点＋本線',reference.coreMain),
      stats('上位4点＋参考混合',reference.coreMixed),stats('本線の追加分のみ',reference.main),
      stats('参考混合の追加分のみ',reference.mixed));
  }
  for (const [label,groups] of [['級班別',report.by_grade],['月別',report.by_month]]) {
    const breakdown = node('details');
    breakdown.append(node('summary',label+'・共通レース'));
    for (const [name,row] of Object.entries(groups)) {
      breakdown.append(list([[name,row.core.races+'R'],['本線追加1点',pct(row.main.roi)],
        ['混合追加1点',pct(row.mixed.roi)]]));
    }
    if (Object.keys(groups).length) panel.append(breakdown);
  }
  return panel;
}

function showTrials(prospective) {
  const summary = element('trial-summary');
  if (!prospective) {
    summary.textContent = '検証結果を読み込めませんでした。';
    return;
  }
  const models = Object.entries(prospective.shadow || {}).sort(([a],[b])=>b.localeCompare(a,'en',{numeric:true}));
  if (!models.length) {
    summary.textContent = '追加1点の検証データを準備中です。';
    return;
  }
  const latest = models[0][1];
  summary.replaceChildren(list([
    ['集計済み',latest.all.core.races+'レース'],
    ['結果待ち',latest.pending+'レース'],
    ['同じレースで比較できた件数',latest.paired.core.races+'レース']
  ]));
  if (!latest.all.core.races) summary.append(node('p','発走前の予想を保存済みです。結果が届くと成績が表示されます。'));
  if (latest.paired.core.races) summary.append(list([
    ['本線を1点追加した分の回収率',pct(latest.paired.main.roi)],
    ['別線2着を1点追加した分の回収率',pct(latest.paired.mixed.roi)]
  ]));
  else if (latest.all.core.races) summary.append(node('p','両方式を同じレースで比べられる結果はまだありません。'));
  for (const [i,[model,report]] of models.entries()) {
    const panel = shadowReport(model,report);
    panel.querySelector('summary').textContent = i === 0 ? '最新の詳しい内訳を見る' : '過去の検証版を見る｜'+model;
    element('trial-details').append(panel);
  }
}

async function validation(prospectiveReport) {
  const panel = node('details');
  panel.append(node('summary','確率校正と発走前の並走評価'));
  const calibrationResponse = await fetch('data/roi/calibration.json',{cache:'no-cache'});
  const calibration = calibrationResponse.ok ? await calibrationResponse.json() : null;
  const prospective = await prospectiveReport;
  if (calibration?.holdout) {
    const h = calibration.holdout;
    panel.append(list([['校正の学習',calibration.training_races+'R'],['時系列検証',h.races+'R'],
      ['Log Loss',h.log_loss?.toFixed(3) ?? '—'],['Brier Score',h.brier?.toFixed(3) ?? '—']]));
    const reliability = node('details');
    reliability.append(node('summary','検証期間の校正曲線の集計'));
    for (const bin of h.reliability.filter(b=>b.count)) {
      reliability.append(list([['確率帯',pct(bin.min)+'〜'+pct(bin.max)],['組合せ数',bin.count],
        ['予測平均',pct(bin.predicted)],['観測頻度',pct(bin.observed)]]));
    }
    panel.append(reliability);
  }
  if (prospective) {
    const rows=Object.entries(prospective.models);
    if (!rows.length) panel.append(node('p','発走前に保存した予想の結果待ち '+prospective.status.pending+'R'));
    for (const [id,strategies] of rows) {
      panel.append(node('h3',id));
      for (const [name,stats] of Object.entries(strategies)) {
        panel.append(list([[name,stats.evaluated+'R'],['購入レース',stats.purchased],['回収率',pct(stats.roi)],
          ['総損益',yen(stats.net)],['最大ドローダウン',yen(stats.max_drawdown)]]));
      }
    }
  }
  element('validation').append(panel);
}
