'use strict';
const assert = require('node:assert/strict');
const {chromium, webkit, devices} = require('playwright');

async function main() {
  const browser = process.env.ROI_BROWSER === 'chromium' || process.env.ROI_CHROMIUM ?
    await chromium.launch({executablePath:process.env.ROI_CHROMIUM,args:['--no-sandbox']}) : await webkit.launch();
  try {
    const context = await browser.newContext(devices['iPhone 13']);
    const page = await context.newPage();
    const errors = [];
    const file = 'a'.repeat(64)+'.json';
    let hasRaces = true,hasBuy=false,expired=false;
    await page.route('**/data/roi/decisions/**/index.json',route=>route.fulfill({json:{rows:hasBuy?[{model:'test',race_id:'test',race:{date:'2098-12-31',venue:'試験',number:1,start:'20:00'},saved_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+(expired?-1000:60000)).toISOString(),decision:{status:'buy',tickets:[{key:'1-2-3',probability:.025,odds:80,ev:2}]}}]:[]}}));
    await page.route('**/data/roi/forecasts/**/index.json', route => hasRaces ?
      route.fulfill({json:{model:'test',rows:[{model:'test',race_id:'test',cutoff:'2099-01-01T00:00:00Z',file,
        race:{date:'2098-12-31',venue:'試験',number:1,start:'20:00'},decision:{tickets:[],reason:'calibration'},
        candidates:['1-2-3']}]}}) : route.fulfill({status:404}));
    await page.route('**/data/roi/forecasts/**/'+file, route => route.fulfill({json:{
      stories:{LAB:{main:{title:'試験展開',axis:'試験',scenes:Array.from({length:6},()=>({phase:'局面',order:[1,2,3],text:'試験'}))}},LINE:{main:null}},
      shadow:{core:['1-2-3'],main:null,mixed:{}}
    }}));
    page.on('pageerror',error=>errors.push(error.message));
    const url = process.env.ROI_TEST_URL || 'http://127.0.0.1:8765/roi.html';
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.locator('#performance dl').first().waitFor({timeout:30000});
    assert.match(await page.locator('#performance').innerText(),/回収率/);
    await page.locator('#dimension').selectOption('grade');
    await page.locator('#performance summary').click();
    assert.match(await page.locator('#performance').innerText(),/S級/);
    await page.getByLabel('レースを選ぶ').waitFor();
    assert.match(await page.locator('#today [role=status]').innerText(),/購入判断　見送り/);
    const copy = page.getByRole('button',{name:'研究候補をコピー'});
    assert.equal(await copy.isVisible(),false);
    await page.getByText('研究候補の買い目を見る',{exact:true}).click();
    assert(await copy.isVisible());
    await page.getByText('レース展開を見る',{exact:true}).click();
    await page.locator('#stories summary').first().click();
    assert.equal(await page.locator('#stories details[open] li').count(),6);
    await page.getByRole('link',{name:'追加1点の結果'}).click();
    assert.equal(new URL(page.url()).hash,'#trial-results');
    await page.locator('#trial-summary dl').waitFor();
    assert.match(await page.locator('#trial-summary').innerText(),/結果待ち/);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    hasBuy=true;
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'購入買い目をコピー'}).waitFor();
    assert.match(await page.locator('#purchases').innerText(),/各100円/);
    assert.match(await page.locator('#today').innerText(),/2.5%/);
    expired=true;await page.reload({waitUntil:'domcontentloaded'});
    await page.getByText('現在の購入対象　0レース',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'購入買い目をコピー'}).count(),0);
    hasRaces = false;
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByText('本日の発走前の配信はありません。',{exact:true}).waitFor();
    assert.equal(await page.locator('#race-stories').isVisible(),false);
    assert.deepEqual(errors,[]);
    console.log('ROI mobile: aggregates, grade filter, layout and available forecast paths OK');
  } finally {
    await browser.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});