'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const id='202611263109',root=path.resolve('.');
 const item=JSON.parse(fs.readFileSync('data/mrt_odds/latest/'+id+'.json'));
 const clock=Date.parse(item.plan.generated_at)+1000;
 const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!p.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}try{res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':p.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(p));}catch(e){res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.ODDS_BROWSER_PATH?{executablePath:process.env.ODDS_BROWSER_PATH}:{})});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:clock});
  await page.goto('http://127.0.0.1:'+server.address().port+'/mrt-micro.html?race='+id);
  await page.waitForFunction(()=>document.getElementById('odds-state').textContent.includes('取得時点'));
  assert.equal(await page.locator('#odds-rows tr').count(),item.plan.tickets.length);
  assert.match(await page.locator('#odds-summary').textContent(),new RegExp(item.plan.stake_yen.toLocaleString('ja-JP')));
  for(const width of [320,390]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  // Current odds become unusable after 20 minutes even while sales remain open.
  const stale=Date.parse(item.quote.published_at)+21*60000;
  assert(stale<Date.parse(item.quote.sales_close_at)-120000);
  await page.clock.setFixedTime(stale);await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(()=>document.getElementById('odds-state').textContent.includes('更新待ち'));
  assert.equal(await page.locator('#odds-rows tr').count(),0);
  await page.clock.setFixedTime(Date.parse(item.quote.sales_close_at)+1000);await page.locator('#refresh').click();
  await page.waitForFunction(()=>document.getElementById('odds-state').textContent.includes('締切済み'));
  assert.equal(await page.locator('#odds-rows tr').count(),item.plan.tickets.length);
  assert.deepEqual(errors,[]);console.log('MICRO mobile odds: saved quote, plan, 320/390px, stale hiding and historical display passed');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
