'use strict';
const assert=require('node:assert/strict');
const {webkit,chromium,devices}=require('playwright');
async function main(){
 const browser=process.env.B_AXIS_BROWSER==='chromium'?await chromium.launch({args:['--no-sandbox']}):await webkit.launch();
 try{
  const page=await browser.newPage({...devices['iPhone 13']});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.B_AXIS_TEST_URL||'http://127.0.0.1:8765/b-axis.html',{waitUntil:'domcontentloaded'});
  assert.match(await page.locator('h1').innerText(),/B-AXIS/);
  await page.locator('summary').first().click();
  await page.locator('#example7').click();
  await page.locator('#b-choice option').first().waitFor({state:'attached',timeout:20000});
  assert.equal(await page.locator('#selector').isVisible(),true);
  assert.equal(await page.locator('#positions .place').count(),7,'7-rider B state');
  assert.equal(await page.locator('#phases details').count(),6,'six phases visible');
  const firstTimeline=await page.evaluate(()=>JSON.stringify(window.bAxisOutput.b.phases));
  const firstB=await page.locator('#b-choice').inputValue();
  const candidates=await page.locator('#b-choice option').evaluateAll(ops=>ops.map(x=>x.value));
  const alternative=candidates.find(x=>x!==firstB);
  assert(alternative,'alternative B available');
  const initialHeadline=await page.locator('#b-headline').innerText();
  await page.locator('#b-choice').selectOption(alternative);
  assert.notEqual(await page.locator('#b-headline').innerText(),initialHeadline);
  assert.match(await page.locator('#scenario').innerText(),new RegExp(''+alternative+'番が最終(?:B|バック)'));
  assert.equal(await page.locator('#positions .place').count(),7,'all rider states recomputed');
  assert.notEqual(await page.evaluate(()=>JSON.stringify(window.bAxisOutput.b.phases)),firstTimeline,'changing B recomputes the full race');
  const t=await page.locator('#tactic-choice option').evaluateAll(xs=>xs.map(x=>x.value));
  if(t.length>2)await page.locator('#tactic-choice').selectOption(t[2]);
  await page.locator('#model-choice').selectOption('baseline');
  assert.equal(await page.evaluate(()=>window.bAxisOutput.version),'LAB_B_AXIS_V0.2.0');
  await page.locator('#model-choice').selectOption('interaction');
  assert.equal(await page.evaluate(()=>window.bAxisOutput.version),'LAB_B_AXIS_V0.6.0');
  const i=await page.evaluate(()=>window.bAxisOutput.b.interactions);
  assert.equal(i.estimatedPopulationBlockSuccessRate,null);
  await page.locator('#limit').selectOption('3');
  assert(await page.locator('.ticket').count()<=3,'max 3 tickets');
  assert.equal(await page.locator('#extras').isVisible(),true);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile no horizontal overflow');
  await page.locator('#example9').click();
  await page.waitForFunction(()=>document.querySelectorAll('#positions .place').length===9,{timeout:20000});
  assert.equal(await page.locator('#positions .place').count(),9,'9-rider B state');
  assert.equal(await page.locator('#phases details').count(),6,'six stages on nine-rider page');
  assert.equal(await page.evaluate(()=>window.bAxisOutput.b.phases[3].leader),Number(await page.locator('#b-choice').inputValue()));
  assert.deepEqual(errors,[]);
  console.log('B-AXIS iPhone Safari: 7/9-car examples, user B switch, tactic switch, max points, mobile layout OK');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
