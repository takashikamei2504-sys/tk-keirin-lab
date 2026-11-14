'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const H=require('../js/crossline/purchase-handoff.js');
const date='2030-05-03',now=Date.parse(date+'T10:00:00+09:00');
const row={date,venue:'奈良',race_no:7,start:'21:00',startAt:Date.parse(date+'T21:00:00+09:00'),
 source:'frozen',forecast:{eligible:true,stake:400,category:'A7',
  candidate4:['1-3-5','1-3-2','4-2-3','4-2-1'],
  tickets:['1-3-5','1-3-2','4-2-3','4-2-1']}};
assert.equal(H.validRow(row,now),true);
const slip=H.ticketText(row,now);
assert.match(slip,/奈良/);assert.match(slip,/7R/);assert.match(slip,/1-3-5　100円/);
assert.match(slip,/合計4点・400円/);
assert.equal((slip.match(/100円/g)||[]).length,5); // heading + four lines
assert.deepEqual(row.forecast.tickets,['1-3-5','1-3-2','4-2-3','4-2-1'],'handoff must not mutate tickets');
for(const site of ['winticket','kdreams']){
 const u=new URL(H.destination(site));
 assert.equal(u.protocol,'https:');
 assert.equal(u.search,'','do not transmit ticket params');
 assert.equal(u.hash,'','do not transmit tickets in fragment');
 assert.ok(['www.winticket.jp','keirin.kdreams.jp'].includes(u.hostname));
}
assert.equal(H.destination('winticket'),'https://www.winticket.jp/keirin');
assert.equal(H.destination('kdreams'),'https://keirin.kdreams.jp/');
assert.throws(()=>H.destination('unknown'));
assert.equal(H.validRow({...row,source:'retrospective'},now),false);
assert.equal(H.validRow({...row,forecast:{...row.forecast,eligible:false}},now),false);
assert.equal(H.validRow({...row,forecast:{...row.forecast,stake:800}},now),false);
assert.equal(H.validRow({...row,forecast:{...row.forecast,tickets:['1-3-5']}},now),false);
assert.equal(H.validRow({...row,forecast:{...row.forecast,tickets:['1-3-5','1-3-5','4-2-3','4-2-1']}},now),false);
assert.equal(H.validRow(row,row.startAt),false,'never offer purchase handoff at or after scheduled start');
assert.throws(()=>H.ticketText(row,row.startAt));
assert.throws(()=>H.ticketText({...row,source:'retrospective'},now));
const html=fs.readFileSync(path.join(__dirname,'../crossline-selected.html'),'utf8');
const view=fs.readFileSync(path.join(__dirname,'../js/crossline/selected-view.js'),'utf8');
for(const expected of ['site-handoff-detail','detail-winticket','detail-kdreams','js/crossline/purchase-handoff.js'])assert.ok(html.includes(expected));
assert.ok(view.includes('CrosslinePurchaseHandoff.validRow'));
assert.ok(view.includes('CrosslinePurchaseHandoff.destination'));
assert.ok(view.includes('target='));
assert.ok(html.includes('rel="noopener noreferrer"'));
console.log('PASS WINTICKET / Rakuten Kdreams official handoff; cutoff, no auto submission, no ticket URL data');
