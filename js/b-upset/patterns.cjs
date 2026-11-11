'use strict';

const EXACT = {BBB:'A', BFB:'B', BBF:'C', FBB:'D', BFF:'E', FBF:'F', FFB:'G'};
const LABELS = {
  A:'B-B-B｜非有力ライン独占', B:'B-F-B｜B勝利・F混合',
  C:'B-B-F｜B上位独占', D:'F-B-B｜F勝利・B残り',
  E:'B-F-F｜B勝利・F追込', F:'F-B-F｜交互決着',
  G:'F-F-B｜F優勢・B3着', H:'X混入', Z:'Bライン不残存'
};

function membership(lineup) {
  const map = new Map();
  lineup.forEach((members, index) => {
    if (!members.length) throw Error('空のライン');
    members.forEach((no, role) => {
      if (!Number.isInteger(no) || map.has(no)) throw Error('所属ラインの重複・車番不正');
      map.set(no, {line_id:'L'+index, role:role+1, size:members.length});
    });
  });
  return map;
}

function classify(trio, lineup, favorite, back) {
  const map = membership(lineup);
  if (favorite === back || !lineup[Number(favorite.slice(1))] || !lineup[Number(back.slice(1))]) throw Error('F/Bの指定が不正');
  if (trio.length !== 3 || new Set(trio).size !== 3 || trio.some(n => !map.has(n))) throw Error('三連単の車番が不正');
  const roles = trio.map(n => map.get(n));
  const code = roles.map(p => p.line_id === back ? 'B' : p.line_id === favorite ? 'F' : 'X').join('');
  const pattern = !code.includes('B') ? 'Z' : EXACT[code] || 'H';
  const f = lineup[Number(favorite.slice(1))], b = lineup[Number(back.slice(1))];
  const place = no => no === undefined ? null : trio.indexOf(no) < 0 ? 0 : trio.indexOf(no)+1;
  return {
    pattern, label:LABELS[pattern], code,
    subtype:pattern === 'H' ? 'H'+({X:1,B:2,F:3})[code[0]] : null,
    b_top2:code.slice(0,2).split('').filter(c => c === 'B').length,
    b_top3:code.split('').filter(c => c === 'B').length,
    b_positions:[place(b[0]),place(b[1]),place(b[2])],
    f_positions:[place(f[0]),place(f[1])],
    x:trio.filter(n => ![favorite,back].includes(map.get(n).line_id)).map(no => ({no,...map.get(no),solo:map.get(no).size===1}))
  };
}

module.exports = {EXACT, LABELS, membership, classify};
