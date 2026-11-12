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

    const jstDate=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
    const race={date:jstDate,venue:'テスト場',number:4,start:'23:59'};
    const cutoff=new Date(jstDate+'T23:59:00+09:00').toISOString();
    const saved_at=new Date(Date.parse(cutoff)-15*60000).toISOString();
    const file7='b'.repeat(64)+'.json',file9='c'.repeat(64)+'.json';
    const t7=['1-2-3','2-3-4','3-4-5','4-5-6','5-6-7'];
    const t9=['1-2-3','2-3-4','3-4-5','4-5-6','5-6-7','6-7-8'];
    const entry=(race,file,candidates)=>({
      file,race_id:[race.date,race.venue,race.number].join(':'),race,
      cutoff,saved_at,model:'frozen-test-model',candidates
    });
    const first=entry(race,file7,t7);
    const second=entry({...race,number:5},file9,t9);
    const details=(index,cars)=>({
      race_id:index.race_id,race:index.race,saved_at,cutoff,
      model:{model_id:'frozen-test-model'},comparison:{coverage:index.candidates},
      identity:Array.from({length:cars},(_,i)=>[i+1,String(100+i),'選手'+(i+1)])
    });
    await page.route('**/data/roi/forecasts/**/index.json',
      route=>route.fulfill({json:{date:jstDate,model:'frozen-test-model',rows:[first,second]}}));
    await page.route('**/data/roi/forecasts/**/'+file7,
      route=>route.fulfill({json:details(first,7)}));
    await page.route('**/data/roi/forecasts/**/'+file9,
      route=>route.fulfill({json:details(second,9)}));

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

    await page.locator('#today-list .today-race').first().waitFor({timeout:30000});
    assert.equal(await page.locator('#today-list .today-race').count(),2);
    assert.equal(await page.locator('#today-pass').innerText(),'1');
    assert.equal(await page.locator('#today-skip').innerText(),'1');
    assert.match(await page.locator('#today-list').innerText(),/見送り理由：9車立て/);
    await page.locator('#today-filter').selectOption('pass');
    assert.equal(await page.locator('#today-list .today-race').count(),1);
    const openedDetails=page.locator('#today-list .today-race details');
    if(!(await openedDetails.evaluate(el=>el.open)))await openedDetails.locator('summary').click();
    assert.match(await page.locator('#today-list').innerText(),/1-2-3/);
    assert(await page.getByRole('button',{name:'買い目をコピー'}).isVisible());
    await page.locator('#today-filter').selectOption('skip');
    assert.equal(await page.locator('#today-list .today-race').count(),1);
    assert.match(await page.locator('#today-list').innerText(),/9車立て/);
    await page.locator('#today-filter').selectOption('all');
    await page.locator('#cars').selectOption('all');
    assert.equal(await page.locator('#today-skip').innerText(),'1');
    assert.match(await page.locator('#today-list').innerText(),/試算 通過/);
    await page.locator('#reset').click();

    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const promise=page.waitForEvent('download');
    await page.locator('#export').click();
    assert.match((await promise).suggestedFilename(),/^coverage-gate-/);
    assert.deepEqual(errors,[]);
    console.log('COVERAGE GATE mobile: current-day frozen tickets, buy/skip, forward split, controls, CSV and iPhone layout OK');
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
