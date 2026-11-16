const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium, webkit, devices} = require('playwright');

async function test() {
  const browser = await (process.env.TWO_T_WEBKIT ? webkit : chromium).launch(
    process.env.CHROMIUM_BIN ? {executablePath: process.env.CHROMIUM_BIN} : {});
  try {
    const page = await browser.newPage({...devices['iPhone 13'], viewport: {width: 390, height: 844}});
    const input = process.argv[2];
    assert.ok(input, 'standalone preview is required');
    await page.goto(pathToFileURL(path.resolve(input)).href);
    await page.locator('#tickets tr').first().waitFor();
    assert.ok([42, 72].includes(await page.locator('#tickets tr').count()));
    assert.match(await page.locator('#source').textContent(), /確定オッズ利用・実購入再現不可/);
    await page.selectOption('#sort', 'prob');
    const first = await page.locator('#tickets tr').nth(0).locator('td').nth(1).textContent();
    const second = await page.locator('#tickets tr').nth(1).locator('td').nth(1).textContent();
    assert.ok(parseFloat(first) >= parseFloat(second));
    const options = await page.locator('#day option').allTextContents();
    const found = new Set();
    for (const day of options) {
      await page.selectOption('#day', day);
      for (const venue of await page.locator('#venue option').allTextContents()) {
        await page.selectOption('#venue', venue);
        for (const race of await page.locator('#race option').allTextContents()) {
          const n = race.includes('9車') ? 9 : 7;
          if (found.has(n)) continue;
          await page.selectOption('#race', {label:race});
          assert.equal(await page.locator('#tickets tr').count(), n*(n-1));
          found.add(n);
        }
        if (found.size === 2) break;
      }
      if (found.size === 2) break;
    }
    assert.equal(found.size, 2);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.selectOption('#mode', 'forward');
    assert.match(await page.locator('#state').textContent(), /まだありません/);
    console.log('PASS iPhone 13 viewport 390px; races 42/72; probability sort; separate forward status');
  } finally {
    await browser.close();
  }
}
test().catch(error => { console.error(error); process.exitCode = 1; });
