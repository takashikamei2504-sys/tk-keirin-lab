'use strict';
// Read a WINTICKET racecard HTML snapshot that the operator is authorized to access.
// This module makes NO network requests and does not bypass access controls.
const fs = require('node:fs');

const FIELD_MAP = Object.freeze({
  exSpurt: 'kamashi',
  exThrust: 'tsuppari',
  exSplitLine: 'chigiri',
  exLeftBehind: 'chigirarare',
  exSnatch: 'tobitsuki',
  exCompete: 'seri' // WINTICKET EX contest success field
});
const CONFIRMED_KEYS = new Set(Object.keys(FIELD_MAP));
const CONTEXT_KEYS=Object.freeze({
  lineSingleHorseman:['position','solo'],linePositionFirst:['position','leader'],
  linePositionSecond:['position','second'],linePositionThird:['position','thirdPlus'],
  lineCompete:['position','compete'],
  raceTypeQualifyingRound:['race_type','qualifying'],raceTypeSemifinal:['race_type','semifinal'],
  raceTypeFinal:['race_type','final'],raceTypeLoserRound:['race_type','loser'],
  raceTypeSpecial:['race_type','seed'],
  trackDistance333:['bank_length','333'],trackDistance400:['bank_length','400'],trackDistance500:['bank_length','500'],
  weatherSunny:['weather','sun'],weatherCloudy:['weather','cloud'],weatherRainy:['weather','rain'],weatherSnowy:['weather','snow'],
  hourTypeNormal:['time_band','day'],hourTypeMorning:['time_band','morning'],
  hourTypeNight:['time_band','night'],hourTypeMidnight:['time_band','midnight'],hourTypeSummertime:['time_band','summertime']
});
function contextCount(v){
  if(!v||typeof v!=='object')return null;
  const names=['first','second','third','others','total'];
  if(names.some(k=>!Number.isInteger(v[k])||v[k]<0))return null;
  const [first,second,third,others,n]=names.map(k=>v[k]);
  if(n<=0||first+second+third+others!==n)return null;
  return {opportunities:n,wins:first,top3:first+second+third,first,second,third,others};
}


function extractPreloadedState(html) {
  const match = /window\.__PRELOADED_STATE__\s*=\s*/.exec(html);
  if (!match) throw new Error('PRELOADED_STATE_MISSING');
  const start = match.index + match[0].length;
  if (html[start] !== '{') throw new Error('PRELOADED_STATE_NOT_JSON_OBJECT');
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      return JSON.parse(html.slice(start, i + 1));
    }
  }
  throw new Error('PRELOADED_STATE_TRUNCATED');
}

function getRaceData(state) {
  const queries = state && state.tanStackQuery && state.tanStackQuery.queries;
  if (!Array.isArray(queries)) throw new Error('TANSTACK_QUERIES_MISSING');
  const match = queries.find(q => Array.isArray(q.queryKey) &&
    q.queryKey.includes('FETCH_KEIRIN_RACE') &&
    q.queryKey[0] !== 'keirin/race/odds' &&
    Array.isArray(q.state && q.state.data && q.state.data.records));
  if (!match) throw new Error('FETCH_KEIRIN_RACE_RECORDS_MISSING');
  return match.state.data;
}

function percentage(value) {
  const n = value && typeof value === 'object' ? value.percentage : value;
  // An unavailable EX metric is null, not 0. Keep WINTICKET's percentage scale.
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

function knownCounts(value) {
  if (!value || typeof value !== 'object') return null;
  // Source source key names confirmed in live WINTICKET HTML on 2026-11-08.
  // Legacy events/opportunities are supported for explicit offline imports only.
  const a = value.succeeded ?? value.events;
  const b = value.total ?? value.opportunities;
  if (!Number.isInteger(a) || !Number.isInteger(b) || b < 1 || a < 0 || a > b) return null;
  const pct = percentage(value);
  // WINTICKET may round percentages; reject material disagreement.
  if (pct !== null && Math.abs(100*a/b-pct) > 1.01) return null;
  return {events:a, opportunities:b};
}

function sourceURL(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'www.winticket.jp' ||
        !/^\/keirin\/[^/]+\/racecard\/[^/]+\/[0-9]+\/[0-9]+\/?$/.test(u.pathname)) {
      throw new Error('SOURCE_URL_INVALID');
    }
    return u.origin + u.pathname;
  } catch (e) {
    throw new Error('SOURCE_URL_INVALID');
  }
}

function extract(html, options={}) {
  const state = extractPreloadedState(html), data = getRaceData(state);
  const entries = new Map((data.entries || []).map(e => [String(e.playerId), e]));
  const players = new Map((data.players || []).map(p => [String(p.id), p]));
  const rows = [], present = {}, shapes = {}, pairs = {}, inconsistent = {}, otherKeys = new Set();
  for (const rec of data.records) {
    const playerId = rec && rec.playerId;
    if (playerId === null || playerId === undefined) continue;
    const id = String(playerId), raw = {}, percent = {}, counts = {}, contextual = {};
    for (const [field, name] of Object.entries(FIELD_MAP)) {
      const v = (rec && Object.hasOwn(rec,field)) ? rec[field] :
                (rec.ex && Object.hasOwn(rec.ex,field) ? rec.ex[field] : undefined);
      if (v === undefined || v === null) continue;
      raw[field] = v;
      const shape = typeof v === 'object' ? Object.keys(v).sort().join(',') : typeof v;
      (shapes[field] ||= new Set()).add(shape);
      percent[name] = percentage(v);
      const c = knownCounts(v);
      if (c) {counts[name] = c; pairs[field] = (pairs[field] || 0) + 1;}
      else if (v && typeof v === 'object' && Number.isInteger(v.succeeded) && Number.isInteger(v.total) && v.total > 0) inconsistent[field] = (inconsistent[field] || 0) + 1;
      present[field] = (present[field] || 0) + 1;
    }
    for(const [field,[axis,key]] of Object.entries(CONTEXT_KEYS)){
      const v=rec[field] ?? rec.ex?.[field];
      if(!v)continue;
      const c=contextCount(v);
      if(!c)continue;
      if(!contextual[axis])contextual[axis]={};
      contextual[axis][key]=c;
      present[field]=(present[field]||0)+1;
    }
    for (const key of Object.keys(rec || {})) {
      if (/^ex[A-Z]/.test(key) && !Object.hasOwn(FIELD_MAP,key)) otherKeys.add(key);
    }
    if (!Object.keys(raw).length) continue;
    rows.push({
      player_id:id,
      registration_number:players.get(id)?.registrationNumber ?? null,
      name:players.get(id)?.name ?? null,
      car_number:entries.get(id)?.number ?? null,
      percentages:percent, explicitly_counted:counts, contextual, source_fields:raw
    });
  }
  return {
    schema:'tk-winticket-ex-raw-snapshot/v1',
    source_url:sourceURL(options.source_url),
    captured_at:options.captured_at || new Date().toISOString(),
    race_id:data.race?.id ?? null,
    official_source:true,
    verified_numeric_count_pairs:false,
    note:'Raw WINTICKET record values, not independently validated opportunities. EX rates with no verified denominator must not be written to b_axis_ex_observations.',
    key_status:{
      confirmed_from_public_collectors:[...CONFIRMED_KEYS],
      candidate_only:[],
      additional_record_ex_keys:[...otherKeys].sort()
    },
    summary:{players_with_ex:rows.length, fields_seen:present,
      count_pairs_accepted:pairs, count_pairs_rejected:inconsistent,
      field_shapes:Object.fromEntries(Object.entries(shapes).map(([key,types])=>[key,[...types]]))},
    riders:rows
  };
}

function main(argv) {
  const args = {};
  for (let i=0;i<argv.length;i+=2) {
    if (!['--html','--source-url','--out'].includes(argv[i]) || !argv[i+1])
      throw new Error('Usage: node scripts/winticket_ex_extract.cjs --html RACE.html --source-url https://www.winticket.jp/keirin/.../racecard/... --out snapshot.json');
    args[argv[i].slice(2)] = argv[i+1];
  }
  if (!args.html || !args.out || !args['source-url'])
    throw new Error('HTML, output path, and original racecard URL are required');
  const snapshot = extract(fs.readFileSync(args.html,'utf8'),{source_url:args['source-url']});
  if (!snapshot.riders.length) throw new Error('NO_EX_OBSERVATIONS_IN_RACECARD');
  fs.writeFileSync(args.out, JSON.stringify(snapshot,null,2)+'\n');
  process.stdout.write(JSON.stringify(snapshot.summary)+'\n');
}

if (require.main === module) {
  try {main(process.argv.slice(2));}
  catch(e){console.error('WIN_EX_IMPORT_ERROR '+e.message);process.exitCode=1;}
}
module.exports={extractPreloadedState,getRaceData,extract,FIELD_MAP,CONTEXT_KEYS,contextCount,percentage,knownCounts};
