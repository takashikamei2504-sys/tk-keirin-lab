'use strict';
const assert=require('node:assert/strict');
const API=require('../../server/mrt-odds.cjs');
const entries=[1,2,3,4,5,6,7].map(n=>({number:n,playerId:10000+n}));
const players=entries.map(e=>({id:e.playerId,name:'選手'+e.number}));
const state={tanStackQuery:{queries:[{queryKey:['FETCH_KEIRIN_RACE'],state:{data:{entries,players}}}]}};
const html='window.__PRELOADED_STATE__ = '+JSON.stringify(state)+'; window.__CONFIG__ = {};';
const p={input:{entry:{players:Object.fromEntries(entries.map(e=>[String(e.number),{rider_id:String(e.playerId)}]))}},
 lines:[[1,2,3],[4,5],[6,7]],manual:{'1-2-3':{leader:{kind:'leader'},members:{kind:'members'}}},automatic:{kind:'auto'}};
assert.equal(API.sourceIdentity(html,p).length,7);
assert.equal(API.sourceIdentity(html,p)[0][1],'10001');
assert.equal(API.snapshotChoice(p,{mode:'automatic'}).kind,'auto');
assert.equal(API.snapshotChoice(p,{mode:'manual',line:'1-2-3',rule:'leader'}).kind,'leader');
assert.throws(()=>API.snapshotChoice(p,{mode:'manual',line:'3-2-1',rule:'leader'}),/unknown_line/);
assert.throws(()=>API.snapshotChoice(p,{mode:'manual',line:'1-2-3',rule:'invalid'}),/invalid_condition/);
const wrong=structuredClone(p);wrong.input.entry.players['7'].rider_id='9999';
assert.throws(()=>API.sourceIdentity(html,wrong),/roster_mismatch/);
assert.throws(()=>API.sourceIdentity('no preloaded state',p),/source_format/);
console.log('PASS MRT odds server: identity, provider names, manual condition and fail-closed provider parsing');
