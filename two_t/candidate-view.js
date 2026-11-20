const byId = id => document.getElementById(id);
const base = 'https://raw.githubusercontent.com/takashikamei2504-sys/tk-keirin-lab/lab-2t-annual-data/data/2t-exacta-forward/';
const today = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Tokyo'}).format(new Date());
const time = value => new Intl.DateTimeFormat('ja-JP', {timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(value));
const percent = value => (value * 100).toFixed(2) + '%';
let records = [];
let selectedModel = 'direct';

async function getJSON(url) {
  const response = await fetch(url, {signal:AbortSignal.timeout(10000),cache:'no-cache'});
  if (!response.ok) throw new Error('予測の取得に失敗しました');
  return response.json();
}

function validate(record, saved) {
  const cars = record.card.cars;
  if (![7,9].includes(cars.length) || new Set(cars).size !== cars.length ||
      !Number.isFinite(Date.parse(saved)) ||
      Date.parse(saved) > Date.parse(record.card.sales_close) - 600000 ||
      Date.parse(record.issued_at) > Date.parse(record.card.sales_close) - 600000) {
    throw new Error('予測の保存時刻または車立てを確認できません');
  }
  for (const name of ['direct','mlp']) {
    const probabilities = record.models[name].p;
    const keys = cars.flatMap(i => cars.filter(j => j !== i).map(j => i + '-' + j));
    if (Object.keys(probabilities).length !== keys.length ||
        keys.some(key => !Number.isFinite(probabilities[key]) || probabilities[key] <= 0 || probabilities[key] >= 1) ||
        Math.abs(Object.values(probabilities).reduce((a,b) => a+b,0) - 1) > 0.000001) {
      throw new Error('予測確率の検証に失敗しました');
    }
  }
}

async function loadLive() {
  const manifest = await getJSON(base + today + '/manifest.json');
  const run = await getJSON(base + today + '/run-' + today.replaceAll('-','') + '.json');
  if (manifest.date !== today || run.date !== today) throw new Error('予測日が一致しません');
  const groups = await Promise.all(Object.entries(manifest.files).map(async ([file, meta]) => {
    if (!/^venue-\d{2}\.json$/.test(file)) throw new Error('予測ファイルが不正です');
    const response = await fetch(base + today + '/' + file, {signal:AbortSignal.timeout(10000),cache:'no-cache'});
    if (!response.ok) throw new Error('会場予測が取得できません');
    const text = await response.text();
    const bytes = new TextEncoder().encode(text.replace(/\n$/, ''));
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2,'0')).join('');
    if (sha !== meta.sha256) throw new Error('保存予測のハッシュが一致しません');
    const group = JSON.parse(text);
    if (group.length !== meta.races) throw new Error('レース数が一致しません');
    return group;
  }));
  return {date:today,saved_at:run.github_saved_at,records:groups.flat()};
}

function showRace() {
  const record = records.find(x => x.card.race_id === byId('candidate-race').value);
  if (!record) return;
  const {card,models} = record;
  byId('candidate-heading').textContent = card.venue + ' ' + card.race_no + 'R ・ ' + card.cars.length + '車';
  byId('candidate-time').textContent = '予測固定 ' + time(record.issued_at) + ' ／ 発売締切 ' + time(card.sales_close) + '（日本時間）';
  const ranked = Object.entries(models[selectedModel].p).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]));
  byId('candidate-tickets').replaceChildren(...ranked.map(([pair, probability]) => {
    const row = document.createElement('tr');
    for (const value of [pair,percent(probability),'未取得','—']) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    return row;
  }));
  byId('candidate-model-note').textContent = selectedModel === 'direct'
    ? '改善候補を暫定採用中。二車単を直接学習したモデルです。'
    : '年次MLPを比較表示しています。';
}

function showVenue() {
  const venue = byId('candidate-venue').value;
  byId('candidate-race').replaceChildren(...records.filter(x => x.card.venue === venue).map(x =>
    new Option(x.card.race_no + 'R（' + x.card.cars.length + '車）',x.card.race_id)));
  showRace();
}

async function start() {
  let payload;
  let liveError;
  try { payload = await loadLive(); }
  catch (error) {
    liveError = error;
    try { payload = await getJSON('./candidate-records.json'); }
    catch {
      byId('candidate-state').textContent = '改善候補の予測を取得できません。再読み込みしてください。';
      return;
    }
  }
  try {
    if (!Array.isArray(payload.records) || !payload.records.length ||
        payload.records.some(x => x.card.date !== payload.date) ||
        new Set(payload.records.map(x => x.card.race_id)).size !== payload.records.length) {
      throw new Error('予測記録が不正です');
    }
    payload.records.forEach(record => validate(record,payload.saved_at));
    records = payload.records.sort((a,b) => a.card.venue.localeCompare(b.card.venue,'ja') || a.card.race_no-b.card.race_no);
    byId('candidate-state').textContent = payload.date + ' ・ ' + records.length + 'レース ・ GitHub保存 ' + time(payload.saved_at) +
      (liveError ? ' ／ 最新取得に失敗したため保存版を表示' : '');
    byId('candidate-date-note').textContent = payload.date !== today ? '表示は過去日の保存予測です。当日の予測はまだ取得できていません。' : '';
    byId('candidate-venue').replaceChildren(...[...new Set(records.map(x => x.card.venue))].map(v => new Option(v,v)));
    byId('candidate-controls').hidden = false;
    byId('candidate-detail').hidden = false;
    showVenue();
  } catch (error) {
    byId('candidate-state').textContent = error.message;
  }
}
byId('candidate-venue').addEventListener('change',showVenue);
byId('candidate-race').addEventListener('change',showRace);
byId('candidate-model').addEventListener('change',event => {selectedModel=event.target.value;showRace();});
start();
