'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:390,height:844}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const race={race_id:'2040-01-01:松山:1',date:'2040-01-01',venue:'松山',race_no:1,start:'16:00',cars:7,cat:'A7',risk:{percent:38.4,priority:true,band:'上位25%'},
  saved_at:'2040-01-01T00:00:01Z',evaluation:{status:'evaluated',actual:[{key:'1-4-2',payout:18000,high:true,crossline:true}],by_mode:{
   baseline:{A:{hit:true,stake:500,payout:18000,hit_keys:['1-4-2']}},
   tactical:{A:{hit:false,stake:500,payout:0,hit_keys:[]}}}},
  modes:['baseline','tactical'].map(name=>({name,pairs:[{key:'1-4',path_ids:['a']}],
    variants:[{id:'A',label:'全通り',scope:'検証専用',tickets:['1-4-2','1-4-3','1-4-5','1-4-6','1-4-7'],evidence:[{why:['最終バック先行ラインの残り目']}]},
     {id:'B',label:'2ペア全通り',scope:'検証専用',tickets:Array(10).fill('1-4-2'),evidence:[]},
     {id:'C',label:'2ペア3着上位2人',scope:'検証専用',tickets:['1-4-2','1-4-3','2-4-1','2-4-3'],evidence:[]}]}))};
 const variant={races:1,hits:1,high_hits:1,avg_points:5,roi:1.1,roi_without_max:0};
 const data={schema:'tk-keirin-mansha-shadow-evaluation/v1',generated_at:new Date().toISOString(),
  summary:{saved:1,evaluated:1,pending:0,by_variant:{'baseline/A':variant,'tactical/A':{...variant,hits:0}}},
  risk_high:{saved:1,evaluated:1,pending:0,by_variant:{'baseline/A':variant}},
  rows:[race]};
 const status={generated_at:new Date().toISOString(),summary:{errors:0}};
 await page.route('**/data/routed_history/mansha_shadow_evaluation.json*',r=>r.fulfill({json:data}));
 await page.route('**/data/routed_history/mansha_shadow_status.json*',r=>r.fulfill({json:status}));
 const base=process.env.LAB_URL||'http://127.0.0.1:8765';
 await page.goto(base+'/mansha-shadow.html');
 await page.locator('#overview .metric').first().waitFor();
 assert.equal(await page.locator('#overview .metric').count(),4);
 assert.match(await page.locator('#row-count').innerText(),/1レース/);
 assert.match(await page.locator('.race h3').innerText(),/松山 1R/);
 await page.locator('.race details').first().locator('summary').click();
 assert.match(await page.locator('.race details').first().innerText(),/1-4-2/);
 await page.locator('#risk-only').check();
 assert.equal(await page.locator('.race').count(),1);
 assert.deepEqual(errors,[]);
 await browser.close();
 console.log('PASS mansha shadow mobile ledger');
})().catch(e=>{console.error(e);process.exitCode=1});
