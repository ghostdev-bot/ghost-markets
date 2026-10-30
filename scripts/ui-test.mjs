// Headless UI test: mock wallet (local test keypair) places a bet through the real UI against a LOCAL validator.
import { chromium } from 'playwright';
import web3 from '@solana/web3.js';
import fs from 'fs';
const kp = web3.Keypair.generate();
const conn = new web3.Connection('http://127.0.0.1:8899', 'confirmed');
await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, 2e9), 'confirmed');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
p.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.addInitScript((sk) => {
  window.phantom = { solana: { isPhantom: true, publicKey: null,
    async connect() { const kp = window.solanaWeb3.Keypair.fromSecretKey(Uint8Array.from(sk)); this._kp = kp; this.publicKey = kp.publicKey; return { publicKey: kp.publicKey }; },
    async signTransaction(tx) { tx.partialSign(this._kp); return tx; }, async disconnect() {} } };
}, Array.from(kp.secretKey));
await p.goto('http://127.0.0.1:8077/?rpc=http://127.0.0.1:8899');
await p.waitForSelector('.mk');
await p.click('#connectBtn');
await p.waitForSelector('#walletWarn:not(.hidden)');
console.log('warn:', (await p.textContent('#walletWarn')).slice(0, 80));
await p.click('.mk[data-id="1"] [data-bet="yes"]');
await p.fill('#mAmt', '0.25');
await p.click('#mConfirm');
await p.waitForFunction(() => /Bet placed|failed/.test(document.querySelector('#statusBar').textContent), null, { timeout: 30000 });
console.log('status:', await p.textContent('#statusBar'));
await p.click('.mk[data-id="2"] [data-bet="no"]'); await p.fill('#mAmt', '0.1'); await p.click('#mConfirm');
await p.waitForFunction(() => /NO 0.1/.test(document.querySelector('#statusBar').textContent) || /failed/.test(document.querySelector('#statusBar').textContent), null, { timeout: 30000 });
await p.waitForTimeout(1500);
console.log('card1:', (await p.textContent('.mk[data-id="1"] .odds')).trim(), (await p.textContent('.mk[data-id="1"] .meta')).trim());
await p.screenshot({ path: 'screenshot-local-desktop.png', fullPage: true });
await p.click('.tab[data-tab="mybets"]'); await p.waitForSelector('#myBets table', { timeout: 15000 });
console.log('mybets rows:', await p.locator('#myBets table').first().locator('tr').count());
await p.screenshot({ path: 'screenshot-local-mybets.png', fullPage: true });
await b.close();
