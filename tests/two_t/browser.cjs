const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
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
    const forward = process.argv[3];
    if (forward) {
      await page.goto(pathToFileURL(path.resolve(forward)).href);
      await page.locator('#tickets tr').first().waitFor();
      assert.equal(await page.locator('#mode').inputValue(), 'forward');
      assert.equal(await page.locator('#status').textContent(), '仮想精算済み');
      assert.match(await page.locator('#outcome').textContent(), /仮想投資 1,700円/);
      assert.match(await page.locator('#outcome').textContent(), /仮想収支 -1,700円/);
      assert.match(await page.locator('#archive-count').textContent(), /3件該当/);
      await page.selectOption('#archive-state', 'settled');
      assert.equal(await page.locator('#archive-list li').count(), 1);
      await page.locator('#archive-list summary').click();
      await page.getByRole('button', {name:'締切10分前の予測を開く'}).click();
      assert.equal(await page.locator('#tickets tr').count(), 42);
      await page.selectOption('#archive-state', 'pending');
      await page.locator('#archive-list summary').click();
      await page.getByRole('button', {name:'締切10分前の予測を開く'}).click();
      assert.match(await page.locator('#outcome').textContent(), /結果照合待ち/);
      await page.selectOption('#archive-state', 'card');
      await page.selectOption('#archive-field', '9');
      assert.match(await page.locator('#archive-empty').textContent(), /条件に合う記録がありません/);
      await page.selectOption('#archive-field', '7');
      await page.selectOption('#archive-venue', '台帳テスト場');
      await page.selectOption('#archive-day', {index: 1});
      await page.fill('#archive-query', '台帳選手 １２Ｒ');
      assert.equal(await page.locator('#archive-list li').count(), 1);
      await page.locator('#archive-list summary').click();
      assert.match(await page.locator('#archive-list details').textContent(), /出走表保存.*結果未取得/);
      assert.equal(await page.locator('#archive-list button').count(), 0);
      await page.locator('#race').selectOption({index: 1});
      assert.match(await page.locator('#outcome').textContent(), /結果照合待ち/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const url = 'https://takashikamei2504-sys.github.io/tk-keirin-lab/two_t/';
      const pageSource = fs.readFileSync('two_t/index.html', 'utf8');
      const match = file => fs.readFileSync(file,'utf8').match(/type="application\/json">([^<]+)</)[1];
      await page.route(url, route => route.fulfill({contentType:'text/html', body:pageSource}));
      await page.route(url + 'race-records.json', route => route.fulfill({contentType:'application/json', body:match(input)}));
      const feed = 'https://raw.githubusercontent.com/takashikamei2504-sys/tk-keirin-lab/lab-2t-observations/public/race-records.json';
      async function showFeed(route) {
        return route.fulfill({contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body:match(forward)});
      }
      await page.route(feed, showFeed);
      const now = Date.now();
      const date = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(now);
      const clock = Date.parse(date + 'T12:00:00+09:00');
      await page.clock.setFixedTime(clock);
      const live = JSON.parse(match(forward));
      live.manual = [
        {race_id:date+':高知:8', status:'window_missed', finished_at:date+'T11:59:00+09:00', run_id:123},
        {race_id:'2000-01-01:高知:7', status:'forecast_saved', finished_at:'2000-01-01T11:00:00+09:00', run_id:124}
      ];
      const base = live.archive[0];
      live.archive.push(
        {...base, date, venue:'松山', race_no:7, race_id:date+':松山:7',
          start:date+'T12:55:00+09:00', sales_close:date+'T12:50:00+09:00'},
        {...base, date, venue:'松山', race_no:6, race_id:date+':松山:6',
          start:date+'T12:04:00+09:00', sales_close:date+'T11:59:00+09:00'},
        {...base, date, venue:'高知', race_no:8, race_id:date+':高知:8',
          start:date+'T13:35:00+09:00', sales_close:date+'T13:30:00+09:00'});
      await page.unroute(feed, showFeed);
      const liveFeed = route => route.fulfill({json:live, headers:{'access-control-allow-origin':'*'}});
      await page.route(feed, liveFeed);
      await page.goto(url);
      await page.locator('#quick-race').waitFor();
      assert.equal(await page.locator('#quick-race option').count(), 2);
      assert.equal(await page.locator('#quick-results li').count(), 1);
      assert.match(await page.locator('#quick-results').textContent(), /高知 8R ・ オッズの取得時刻を過ぎました/);
      assert.equal(await page.locator('#quick-results a').getAttribute('href'),
                   'https://github.com/takashikamei2504-sys/tk-keirin-lab/actions/runs/123');
      await page.selectOption('#quick-race', date+':高知:8');
      const request = new URL(await page.locator('#quick-submit').getAttribute('href'));
      assert.equal(request.pathname, '/takashikamei2504-sys/tk-keirin-lab/issues/new');
      assert.equal(request.searchParams.get('title'), '2T手動取得 '+date+':高知:8');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.locator('#archive-sync').waitFor();
      assert.match(await page.locator('#archive-sync').textContent(), /締切前予測 2件/);
      assert.equal(await page.locator('#mode').inputValue(), 'forward');
      await page.selectOption('#archive-state', 'replay');
      assert.ok(await page.locator('#archive-list li').count());
      await page.unroute(feed, liveFeed);
      await page.route(feed, route => route.abort());
      await page.reload();
      await page.locator('#archive-sync').waitFor();
      assert.match(await page.locator('#archive-sync').textContent(), /観測記録を取得できません/);
      assert.equal(await page.locator('#mode').inputValue(), 'replay');
    }
    console.log('PASS iPhone 13 viewport 390px; replay, archive search, and forward settlement');
  } finally {
    await browser.close();
  }
}
test().catch(error => { console.error(error); process.exitCode = 1; });
