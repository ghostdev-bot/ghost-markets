// Screenshot the deployed site (desktop + mobile). Usage: node scripts/screenshot.mjs [url]
import { chromium, devices } from 'playwright';
const url = process.argv[2] || 'https://ghostmarkets.surge.sh';
const b = await chromium.launch();
for (const [name, ctxOpts] of [['desktop', { viewport: { width: 1440, height: 1000 } }], ['mobile', { ...devices['iPhone 13'] }]]) {
  const ctx = await b.newContext({ ...ctxOpts, timezoneId: 'America/New_York' });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForSelector('.mk', { timeout: 30000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `screenshot-${name}.png`, fullPage: name === 'desktop' });
  console.log(name, 'ok', (await p.textContent('.devnet-banner')).trim().slice(0, 60), '| cards:', await p.locator('.mk').count(), '| preview:', await p.isVisible('#previewNote'));
  await ctx.close();
}
await b.close();
