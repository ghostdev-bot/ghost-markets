#!/usr/bin/env node
// Ghost Markets admin CLI — DEVNET ONLY, play money only, no real funds.
import web3 from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeGM } from '../site/gm-core.js';
import { PROGRAM_ID, DEVNET_GENESIS, SEEDS } from '../site/config.js';
const { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction } = web3;
const __dir = path.dirname(fileURLToPath(import.meta.url));

const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const FORBIDDEN_KEYS = ['/home/box/wallets/solana-elon.json', '/home/box/wallets/solana-bobo-buy.json', '/home/box/wallets/elon-key-phantom.txt'];

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const URL_ = opt('url', 'https://api.devnet.solana.com');
const KEY = path.resolve(opt('keypair', '/home/box/wallets/devnet-markets.json'));
if (FORBIDDEN_KEYS.includes(KEY)) { console.error('Refusing: that is a mainnet wallet. Devnet keypair only.'); process.exit(2); }
const loadKp = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8'))));
const conn = new Connection(URL_, 'confirmed');
const gm = makeGM(web3, { programId: PROGRAM_ID });
const IS_LOCAL = /127\.0\.0\.1|localhost/.test(URL_);
const ex = (sig) => IS_LOCAL ? `localnet:${sig}` : `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const sol = (l) => (l / LAMPORTS_PER_SOL).toFixed(6);

async function guard() {
  const gh = await conn.getGenesisHash();
  const local = /127\.0\.0\.1|localhost/.test(URL_);
  if (gh === MAINNET_GENESIS) throw new Error('MAINNET detected — refusing. This tool is devnet-only.');
  if (gh !== DEVNET_GENESIS && !local) throw new Error(`Not devnet (genesis ${gh}). Refusing.`);
  return local ? 'localnet' : 'devnet';
}
async function send(ixs, signers, feePayer) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = (feePayer || signers[0]).publicKey;
  return sendAndConfirmTransaction(conn, tx, signers, { commitment: 'confirmed' });
}
const parseEnd = () => {
  if (opt('end')) return Math.floor(new Date(opt('end')).getTime() / 1000);
  if (opt('minutes')) return Math.floor(Date.now() / 1000 + Number(opt('minutes')) * 60);
  return Math.floor(Date.now() / 1000 + Number(opt('hours', '24')) * 3600);
};

async function main() {
  const net = await guard();
  const admin = loadKp(KEY);
  switch (cmd) {
    case 'info': {
      console.log({ network: net, programId: PROGRAM_ID, admin: admin.publicKey.toBase58(), balanceSOL: sol(await conn.getBalance(admin.publicKey)),
        programDeployed: !!(await conn.getAccountInfo(gm.PID)) });
      break;
    }
    case 'list': {
      const ms = await gm.fetchMarkets(conn, admin.publicKey);
      for (const m of ms) {
        const t = m.yes + m.no; const yp = t ? (100 * m.yes / t).toFixed(1) : '50.0';
        console.log(`#${m.id} [${(await import('../site/gm-core.js')).OUTCOME[m.outcome]}] ends ${new Date(m.endTs * 1000).toISOString()} YES ${yp}% | pools Y ${sol(m.yes)} / N ${sol(m.no)} SOL | ${m.question} | ${m.pubkey}`);
      }
      if (!ms.length) console.log('(no markets)');
      break;
    }
    case 'create': {
      const q = opt('question'); if (!q) throw new Error('--question required');
      let id = opt('id') ? Number(opt('id')) : null;
      if (id == null) { const ms = await gm.fetchMarkets(conn, admin.publicKey); id = ms.reduce((a, m) => Math.max(a, m.id), 0) + 1; }
      const end = parseEnd();
      const sig = await send([gm.createMarketIx(admin.publicKey, id, end, q)], [admin]);
      console.log(JSON.stringify({ id, market: gm.marketPda(admin.publicKey, id).toBase58(), end: new Date(end * 1000).toISOString(), sig, explorer: ex(sig) }));
      break;
    }
    case 'seed': {
      const existing = new Set((await gm.fetchMarkets(conn, admin.publicKey)).map((m) => m.id));
      for (const s of SEEDS) {
        const end = Math.floor(new Date(s.end).getTime() / 1000);
        if (existing.has(s.id)) { console.log(`#${s.id} exists`); continue; }
        if (end <= Date.now() / 1000 + 60) { console.log(`#${s.id} skipped (end time passed): edit SEEDS in site/config.js`); continue; }
        const sig = await send([gm.createMarketIx(admin.publicKey, s.id, end, s.question)], [admin]);
        console.log(`#${s.id} created ${ex(sig)}`);
      }
      break;
    }
    case 'resolve': {
      const id = Number(opt('id')); const out = opt('outcome');
      const m = gm.marketPda(admin.publicKey, id);
      const sig = await send([gm.resolveIx(admin.publicKey, m, out)], [admin]);
      console.log(JSON.stringify({ id, outcome: out, sig, explorer: ex(sig) }));
      break;
    }
    case 'payout': { // crank claims for every position (payouts go to each bettor)
      const id = Number(opt('id'));
      const m = gm.marketPda(admin.publicKey, id);
      const ps = await gm.fetchMarketPositions(conn, m);
      const sigs = [];
      for (const p of ps) {
        const sig = await send([gm.claimIx(new PublicKey(p.user), m)], [admin]);
        console.log(`paid ${p.user}: ${ex(sig)}`); sigs.push(sig);
      }
      if (!ps.length) console.log('(no unclaimed positions)');
      break;
    }
    case 'bet': { // for testing with a script wallet
      const id = Number(opt('id')); const side = opt('side'); const amt = Math.round(Number(opt('sol')) * LAMPORTS_PER_SOL);
      const bettor = loadKp(path.resolve(opt('bettor')));
      const m = gm.marketPda(admin.publicKey, id);
      const sig = await send([gm.betIx(bettor.publicKey, m, side, amt)], [bettor]);
      console.log(JSON.stringify({ id, side, sol: amt / LAMPORTS_PER_SOL, sig, explorer: ex(sig) }));
      break;
    }
    case 'e2e': {
      // End-to-end: fund 2 script wallets, create a short market, YES + NO bets, resolve, crank payout, check balances.
      const dir = (process.env.GM_TEST_WALLETS || '/home/box/wallets/test-keys/ghostmarkets'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const mk = (n) => { const f = path.join(dir, n + '.json'); if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600 }); return loadKp(f); };
      const A = mk('alice'), B = mk('bob');
      const FUND = Math.round(Number(opt('fund', '0.05')) * LAMPORTS_PER_SOL);
      const YES_AMT = Math.round(Number(opt('yes', '0.03')) * LAMPORTS_PER_SOL), NO_AMT = Math.round(Number(opt('no', '0.01')) * LAMPORTS_PER_SOL);
      const r = { network: net, alice: A.publicKey.toBase58(), bob: B.publicKey.toBase58(), tx: {} };
      for (const w of [A, B]) if ((await conn.getBalance(w.publicKey)) < FUND / 2) {
        r.tx['fund_' + (w === A ? 'alice' : 'bob')] = await send([SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: w.publicKey, lamports: FUND })], [admin]);
      }
      const ms = await gm.fetchMarkets(conn, admin.publicKey); const id = Math.max(1000, ms.reduce((a, m) => Math.max(a, m.id), 0) + 1);
      const end = Math.floor(Date.now() / 1000) + Number(opt('secs', '40'));
      const mkt = gm.marketPda(admin.publicKey, id);
      r.marketId = id; r.market = mkt.toBase58();
      r.tx.create = await send([gm.createMarketIx(admin.publicKey, id, end, '[E2E TEST] Ghost Markets end-to-end test market (devnet, play money)')], [admin]);
      const bal0 = { a: await conn.getBalance(A.publicKey), b: await conn.getBalance(B.publicKey) };
      r.tx.betYes_alice = await send([gm.betIx(A.publicKey, mkt, 'yes', YES_AMT)], [A]);
      r.tx.betNo_bob = await send([gm.betIx(B.publicKey, mkt, 'no', NO_AMT)], [B]);
      const bal1 = { a: await conn.getBalance(A.publicKey), b: await conn.getBalance(B.publicKey) };
      const mk1 = gm.decodeMarket(mkt, (await conn.getAccountInfo(mkt)).data);
      console.log(`bets placed: pools YES ${sol(mk1.yes)} / NO ${sol(mk1.no)}; waiting for end time...`);
      // early-resolve must fail
      try { await send([gm.resolveIx(admin.publicKey, mkt, 'yes')], [admin]); r.earlyResolveRejected = false; } catch { r.earlyResolveRejected = true; }
      while (true) { const slot = await conn.getSlot(); const t = await conn.getBlockTime(slot); if (t && t > end + 1) break; await new Promise((s) => setTimeout(s, 3000)); }
      try { await send([gm.betIx(A.publicKey, mkt, 'yes', 1000)], [A]); r.lateBetRejected = false; } catch { r.lateBetRejected = true; }
      r.tx.resolveYes = await send([gm.resolveIx(admin.publicKey, mkt, 'yes')], [admin]);
      // Alice claims herself (signed by Alice as fee payer); Bob's (losing) position is cranked by admin
      r.tx.claim_alice = await send([gm.claimIx(A.publicKey, mkt)], [A]);
      r.tx.claim_bob_by_admin = await send([gm.claimIx(B.publicKey, mkt)], [admin]);
      try { await send([gm.claimIx(A.publicKey, mkt)], [A]); r.doubleClaimRejected = false; } catch { r.doubleClaimRejected = true; }
      const bal2 = { a: await conn.getBalance(A.publicKey), b: await conn.getBalance(B.publicKey) };
      const posRent = await conn.getMinimumBalanceForRentExemption(83);
      const fee = 5000;
      // Alice: paid YES_AMT + posRent + fee(bet), got back pool total (YES+NO) + posRent, minus claim fee
      const expA = bal0.a - YES_AMT - posRent - fee + (YES_AMT + NO_AMT) + posRent - fee;
      const expB = bal0.b - NO_AMT - posRent - fee + posRent; // Bob's claim fee paid by admin
      const mkFinal = await conn.getAccountInfo(mkt);
      r.balances = {
        alice: { before: sol(bal0.a), afterBet: sol(bal1.a), afterClaim: sol(bal2.a), expected: sol(expA), ok: bal2.a === expA },
        bob: { before: sol(bal0.b), afterBet: sol(bal1.b), afterClaim: sol(bal2.b), expected: sol(expB), ok: bal2.b === expB },
        marketEscrowLeft: sol(mkFinal.lamports), marketRentExempt: sol(await conn.getMinimumBalanceForRentExemption(269)),
      };
      r.explorer = Object.fromEntries(Object.entries(r.tx).map(([k, v]) => [k, ex(v)]));
      r.pass = r.balances.alice.ok && r.balances.bob.ok && r.earlyResolveRejected && r.lateBetRejected && r.doubleClaimRejected;
      const outf = path.join(__dir, '..', `e2e-result-${net}.json`); fs.writeFileSync(outf, JSON.stringify(r, null, 2));
      console.log(JSON.stringify(r, null, 2));
      break;
    }
    default:
      console.log(`Usage (devnet only):
  node scripts/gm.mjs info
  node scripts/gm.mjs list
  node scripts/gm.mjs create --question "Will $BOBO ...?" (--end 2026-11-02T20:00:00-05:00 | --hours 48 | --minutes 30) [--id N]
  node scripts/gm.mjs seed
  node scripts/gm.mjs resolve --id N --outcome yes|no|void
  node scripts/gm.mjs payout --id N        # pays every bettor on market N (permissionless crank)
  node scripts/gm.mjs bet --id N --side yes|no --sol 0.01 --bettor path/to/devnet-keypair.json
  node scripts/gm.mjs e2e                  # full on-chain test with two script wallets
Options: --url <rpc> (default https://api.devnet.solana.com) --keypair <admin keypair> (default /home/box/wallets/devnet-markets.json)`);
  }
}
main().catch((e) => { console.error('ERROR:', e.message); if (e.logs) console.error(e.logs.join('\n')); process.exit(1); });
