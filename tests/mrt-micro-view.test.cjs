"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const api=require("../js/mrt-micro-view.js");
const root=path.join(__dirname,"..");
const catalog=JSON.parse(fs.readFileSync(path.join(root,"data/mrt_research/micro_forward/view_index.json"),"utf8"));
const ids=api.catalog(catalog);
assert.ok(ids.length>0);
for(const id of ids){
 const p=path.join(root,"data/mrt_research/micro_forward/snapshots",id+".json");
 assert.ok(fs.existsSync(p),"missing indexed fixed record "+id);
 api.validate(JSON.parse(fs.readFileSync(p,"utf8")),id);
}
const s=api.validate(JSON.parse(fs.readFileSync(path.join(root,"data/mrt_research/micro_forward/snapshots",ids[0]+".json"),"utf8")),ids[0]);
const first=s.methods.A_original[0];
const k=first.cars.join("-");
const roster=Object.fromEntries(Object.entries(s.roster).reverse());
const result={race_id:s.race_id,status:"final",roster,payouts:{[k]:12340}};
const state=api.resultState(s,result,{identity_sha256:s.identity_sha256});
assert.equal(state.status,"final");
assert.equal(api.evaluate(s.methods.A_original,state).pay,first.yen*12340/100);
assert.equal(api.evaluate(s.methods.A_original,{status:"pending"}).pay,null);
assert.equal(api.resultState(s,{...result,roster:{...roster,"1":"wrong"}}).status,"excluded");
assert.equal(api.resultState(s,result,{identity_sha256:"changed"}).status,"excluded");
assert.equal(api.resultState(s,null).status,"pending");
assert.throws(()=>api.validate({...s,generated_at:s.sales_close_at},s.race_id),/時刻/);
for(const [m] of api.methods){
 const list=api.tickets(s,m,state);
 const original=new Set(s.methods.A_original.map(t=>t.cars.join("-")));
 assert.equal(list.length,s.methods[m].length);
 assert.ok(list.every(t=>t.added===!original.has(t.combo)));
}
const html=fs.readFileSync(path.join(root,"mrt-micro.html"),"utf8");
assert.ok(html.includes("閲覧専用"));
assert.ok(!html.includes("js/mrt/app.js"));
assert.ok(!html.includes("投票する"));
console.log("MICRO read-only view:",ids.length,"frozen records validated; result, stake and added-ticket checks passed");
