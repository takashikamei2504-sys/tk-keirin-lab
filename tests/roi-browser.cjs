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
    page.on('pageerror',error=>errors.push(error.message));
    const url = process.env.ROI_TEST_URL || 'http://127.0.0.1:8765/roi.html';
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.locator('#performance dl').first().waitFor({timeout:30000});
    assert.match(await page.locator('#performance').innerText(),/回収率/);
    await page.locator('#dimension').selectOption('grade');
    await page.locator('#performance summary').click();
    assert.match(await page.locator('#performance').innerText(),/S級/);
    if (await page.locator('#today select').count()) {
      await page.locator('#stories summary').first().waitFor();
      await page.locator('#stories summary').first().click();
      assert.equal(await page.locator('#stories details[open] li').count(),6);
      assert.match(await page.locator('#today').innerText(),/見送り/);
      assert(await page.getByRole('button',{name:'買い目をコピー'}).isVisible());
    }
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
    console.log('ROI mobile: aggregates, grade filter, layout and available forecast paths OK');
  } finally {
    await browser.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
