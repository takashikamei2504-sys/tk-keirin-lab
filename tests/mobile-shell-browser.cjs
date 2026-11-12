'use strict';
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
(async()=>{
  const kind=process.env.ROUTING_BROWSER==='webkit'?'webkit':'chromium';
  const browser=await (kind==='webkit'?webkit:chromium).launch({headless:true,...(process.env.ROUTING_CHROMIUM_PATH&&kind==='chromium'?{executablePath:process.env.ROUTING_CHROMIUM_PATH}:{})});
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install({time:new Date('2040-01-01T00:00:00Z')});
  const date='2040-01-01';
  const gate={schema:'tk-coverage-gate-validation/v1',policy:{start:'2026-11-13'},summary:{exploratory:{evaluated:1,passedCount:1,passing:{roi:1.2}}},by_date:[{date}],races:[{date,cars:7,heads:4,status:'evaluated',stake:100,payout:1200,hit:true}]};
  const auto={rows:[{date,evaluation:{status:'evaluated',stake:100,payout:1200,hit:true}}]};
  const upset={summary:{evaluated:1,saved:1,views:{expanded:{roi:12,trim1:0}}},rows:[{date,evaluation:{status:'evaluated',views:{expanded:{stake:100,payout:1200,hit:true}}}}]};
  const line={rows:[{race_id:date+':試験:1',evaluation:{status:'evaluated',hit:true}}]};
  const fixture={'coverage_gate/evaluation.json':gate,'routed_history/evaluation.json':auto,'b_upset/evaluation.json':upset,'line_evaluation.json':line};
  await page.route('**/data/**',r=>{
    const url=new URL(r.request().url()),path=url.pathname.split('/data/')[1];
    return fixture[path]?r.fulfill({json:fixture[path]}):r.fulfill({status:404});
  });
  const base=process.env.LAB_URL||'http://127.0.0.1:8765';
  for(const path of ['index.html','high-payout.html','performance.html']){
    await page.goto(base+'/'+path,{waitUntil:'domcontentloaded'});
    await page.locator('.lab-bottom-nav a').first().waitFor();
    assert.equal(await page.locator('.lab-bottom-nav a').count(),4,path+': four navigation links');
    const href=await page.locator('.lab-bottom-nav a').evaluateAll(xs=>xs.map(x=>x.getAttribute('href')));
    assert.deepEqual(href,['auto.html','coverage-gate.html','high-payout.html','performance.html']);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,path+': horizontal overflow');
  }
  await page.waitForFunction(()=>document.getElementById('state')?.textContent.includes('4方式の保存評価を読み込みました。'));
  await page.locator('.lab-performance-item').first().waitFor();
  assert.equal(await page.locator('.lab-performance-item').count(),4);
  assert.match(await page.locator('#results').innerText(),/1200\.0%/);
  assert.match(await page.locator('#results').innerText(),/LAB LINE/);
  await page.locator('#period').selectOption('today');
  assert.match(await page.locator('#state').innerText(),/4方式/);
  await page.goto(base+'/high-payout.html');
  await page.waitForFunction(()=>document.getElementById('b-roi')?.textContent==='1200.0%');
  await page.goto(base+'/index.html');
  await page.waitForFunction(()=>document.getElementById('home-roi')?.textContent==='120.0%');
  assert.equal(await page.locator('.lab-tile').count(),4);
  assert.deepEqual(errors,[]);
  await browser.close();
  console.log('PASS '+kind+' four-screen mobile shell, data summaries and 4-tab navigation');
})().catch(e=>{console.error(e);process.exitCode=1;});
