'use strict';
const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
async function main(){
  const browser=process.env.COVERAGE_BROWSER==='webkit'?await webkit.launch():
    await chromium.launch({args:['--no-sandbox']});
  try{
    const context=await browser.newContext({...devices['iPhone 13'],acceptDownloads:true});
    const page=await context.newPage(),errors=[];
    const base={date:'2026-11-11',cutoff:'2026-11-11T01:00:00.000Z',saved_at:'2026-11-11T00:30:00.000Z',
      venue:'試験',number:1,start:'10:00',model:'test-v1',grade:'チャレンジ',pairs:6,tickets:['1-2-3']};
    const json={
      schema:'tk-coverage-gate-validation/v1',
      policy:{start:'2026-11-13',rules:{cars:'7',maxHeads:5}},
      summary:{},
      races:[
        {...base,race_id:'2026-11-11:試験:1',cars:7,heads:5,points:10,status:'evaluated',stake:1000,payout:2700,hit:true},
        {...base,race_id:'2026-11-11:試験:2',number:2,cars:9,heads:6,points:10,status:'evaluated',stake:1000,payout:0,hit:false},
        {...base,race_id:'2026-11-13:試験:1',date:'2026-11-13',cars:7,heads:4,status:'pending',stake:0,payout:0,points:10,hit:false}
      ],
      errors:[]
    };
    await page.route('**/data/coverage_gate/evaluation.json',route=>route.fulfill({json}));
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(process.env.COVERAGE_TEST_URL||'http://127.0.0.1:8765/coverage-gate.html',{waitUntil:'domcontentloaded'});
    await page.locator('#kpi-gate').getByText('270.0%').waitFor({timeout:30000});
    assert.equal(await page.locator('#kpi-base').innerText(),'135.0%');
    assert.match(await page.locator('#scope-summary').innerText(),/見送り 1R/);
    await page.locator('#cars').selectOption('all');
    await page.locator('#max-heads').selectOption('7');
    assert.equal(await page.locator('#kpi-gate').innerText(),'135.0%');
    assert.match(await page.locator('#mode-chip').innerText(),/探索的/);
    await page.locator('#reset').click();
    assert.equal(await page.locator('#kpi-gate').innerText(),'270.0%');
    await page.locator('#period').selectOption('prospective');
    assert.equal(await page.locator('#kpi-gate').innerText(),'—');
    assert.match(await page.locator('#scope-summary').innerText(),/結果待ち 1R/);
    await page.locator('#period').selectOption('all');
    assert.equal(await page.locator('#races .race').count(),3);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const promise=page.waitForEvent('download');
    await page.locator('#export').click();
    assert.match((await promise).suggestedFilename(),/^coverage-gate-/);
    assert.deepEqual(errors,[]);
    console.log('COVERAGE GATE mobile: frozen data, buy/skip, forward split, controls, CSV and iPhone layout OK');
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
