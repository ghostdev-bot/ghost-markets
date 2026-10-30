// Ghost Markets frontend — DEVNET DEMO, play money only, no real funds.
import { RPC_URL, DEVNET_GENESIS, PROGRAM_ID, ADMIN, SEEDS } from './config.js';
import { makeGM, OUTCOME } from './gm-core.js';

const web3 = window.solanaWeb3;
const { Connection, PublicKey, Transaction, LAMPORTS_PER_SOL } = web3;
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
// Optional ?rpc= override is honored ONLY for localhost test validators; everything else is public devnet.
const qp = new URLSearchParams(location.search);
const rpcOverride = qp.get('rpc');
const RPC = rpcOverride && /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(rpcOverride) ? rpcOverride : RPC_URL;
const conn = new Connection(RPC, 'confirmed');
const gm = makeGM(web3, { programId: PROGRAM_ID });
const $ = (s) => document.querySelector(s);
const fmt = (l) => (l / LAMPORTS_PER_SOL).toLocaleString(undefined, { maximumFractionDigits: 4 });
const exTx = (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;
const exAddr = (a) => `https://explorer.solana.com/address/${a}?cluster=devnet`;

let wallet = null, walletPk = null, markets = [], previewMode = false, chainOk = false, modalState = null;

function status(html, ms = 0) { const el = $('#statusBar'); el.innerHTML = html; el.classList.remove('hidden'); if (ms) setTimeout(() => el.classList.add('hidden'), ms); }
function warn(html) { const el = $('#walletWarn'); if (!html) return el.classList.add('hidden'); el.innerHTML = html; el.classList.remove('hidden'); }

function countdown(endTs) {
  let s = endTs - Math.floor(Date.now() / 1000);
  if (s <= 0) return 'ended';
  const d = Math.floor(s / 86400); s %= 86400; const h = Math.floor(s / 3600); s %= 3600; const m = Math.floor(s / 60); s %= 60;
  return (d ? d + 'd ' : '') + String(h).padStart(2, '0') + 'h ' + String(m).padStart(2, '0') + 'm ' + String(s).padStart(2, '0') + 's';
}
function pct(m) { const t = m.yes + m.no; return t ? (100 * m.yes) / t : 50; }
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function tag(q) { if (/\$BOBO/i.test(q)) return '🐻 $BOBO'; if (/GHOSTDEV/i.test(q)) return '👻 $GHOSTDEV'; if (/\bSOL\b/.test(q)) return '◎ SOL'; if (/flywheel/i.test(q)) return '🌀 pump.fun'; if (/TEST/.test(q)) return '🧪 test'; return '🎲 market'; }

function card(m) {
  const now = Date.now() / 1000, y = pct(m), ended = now >= m.endTs, resolved = m.outcome !== 0;
  const st = resolved ? `<span class="tag res">RESOLVED: ${OUTCOME[m.outcome]}</span>` : ended ? '<span class="tag ended">ENDED · awaiting resolution</span>' : '<span class="tag live">● LIVE</span>';
  const dis = previewMode || ended || resolved ? 'disabled' : '';
  return `<div class="card mk" data-id="${m.id}">
    <span class="tag">${tag(m.question)}</span>${st}
    <h3>${esc(m.question)}</h3>
    <div class="odds"><span class="y">YES ${y.toFixed(1)}%</span><span class="n">NO ${(100 - y).toFixed(1)}%</span></div>
    <div class="bar"><i style="width:${y}%"></i></div>
    <div class="meta"><span>Pool <b>${fmt(m.yes + m.no)}</b> devnet SOL</span><span>Y ${fmt(m.yes)} · N ${fmt(m.no)}</span></div>
    <div class="meta"><span>⏳ <b class="cd" data-end="${m.endTs}">${countdown(m.endTs)}</b></span><span>${new Date(m.endTs * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}</span></div>
    <div class="betrow"><button class="btn yes" data-bet="yes" ${dis}>Bet YES</button><button class="btn no" data-bet="no" ${dis}>Bet NO</button></div>
  </div>`;
}

function render() {
  const open = markets.filter((m) => m.outcome === 0 && m.id < 1000);
  const done = markets.filter((m) => m.outcome !== 0 || m.id >= 1000);
  $('#marketGrid').innerHTML = open.length ? open.map(card).join('') : '<div class="loading">No open markets right now.</div>';
  $('#resolvedGrid').innerHTML = done.map(card).join('');
  $('#resolvedHdr').hidden = !done.length;
}

async function loadMarkets() {
  try {
    if (!chainOk) {
      const gh = await conn.getGenesisHash();
      if (gh === MAINNET_GENESIS) throw new Error('RPC is mainnet. Refusing to run.');
      if (gh !== DEVNET_GENESIS && RPC === RPC_URL) throw new Error('RPC is not devnet');
      chainOk = true;
    }
    const prog = await conn.getAccountInfo(gm.PID);
    if (!prog) {
      previewMode = true;
      $('#previewNote').innerHTML = '🧪 <b>Preview mode.</b> The Ghost Markets program isn\'t live on devnet yet, so these seed markets are shown read-only. Betting turns on automatically once the program is deployed. Devnet demo, play money only, no real funds.';
      $('#previewNote').classList.remove('hidden');
      markets = SEEDS.map((s) => ({ ...s, endTs: Math.floor(new Date(s.end).getTime() / 1000), yes: 0, no: 0, outcome: 0 }));
    } else {
      previewMode = false; $('#previewNote').classList.add('hidden');
      markets = await gm.fetchMarkets(conn, ADMIN);
    }
    render();
  } catch (e) {
    $('#marketGrid').innerHTML = `<div class="loading">Couldn't load markets from devnet: ${esc(String(e.message || e))}. Retrying…</div>`;
  }
}

function getProvider(kind) {
  if (kind === 'solflare') return window.solflare?.isSolflare ? window.solflare : null;
  const p = window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null);
  return p || null;
}
async function connect() {
  if (walletPk) { try { await wallet.disconnect?.(); } catch {} wallet = walletPk = null; $('#connectBtn').textContent = 'Connect wallet'; warn(''); renderMyBets(); return; }
  const phantom = getProvider('phantom'), solflare = getProvider('solflare');
  const prov = phantom || solflare;
  if (!prov) { warn('No Solana wallet found. Install <a href="https://phantom.app" target="_blank">Phantom</a> or <a href="https://solflare.com" target="_blank">Solflare</a>, switch it to <b>Devnet</b>, then reload.'); return; }
  try {
    const r = await prov.connect();
    wallet = prov; walletPk = new PublicKey((r?.publicKey || prov.publicKey).toString());
    $('#connectBtn').textContent = walletPk.toBase58().slice(0, 4) + '…' + walletPk.toBase58().slice(-4) + ' (devnet)';
    await checkWalletNetwork();
    renderMyBets();
  } catch (e) { status('Wallet connection cancelled: ' + esc(String(e.message || e)), 6000); }
}
async function checkWalletNetwork() {
  const bal = await conn.getBalance(walletPk);
  const base = `Your wallet's <b>devnet</b> balance: <b>${fmt(bal)} SOL</b> (play money). `;
  if (bal === 0) {
    warn(`⚠️ ${base}Your wallet looks like it isn't on <b>Devnet</b> or isn't funded yet. Phantom: Settings → Developer Settings → Testnet Mode → <i>Solana Devnet</i>. Solflare: Settings → Network → <i>Devnet</i>. Then <a href="https://faucet.solana.com/" target="_blank">get free devnet SOL</a>. Ghost Markets only ever sends transactions to devnet.`);
  } else {
    warn(`✅ ${base}Make sure your wallet shows <b>Devnet</b> when it asks you to approve. Ghost Markets sends every transaction to Solana devnet only.`);
  }
}

function openModal(id, side) {
  if (!walletPk) { connect(); return; }
  const m = markets.find((x) => x.id === id); if (!m) return;
  modalState = { m, side };
  $('#mQ').textContent = m.question;
  const y = pct(m); $('#mYes').textContent = y.toFixed(0) + '%'; $('#mNo').textContent = (100 - y).toFixed(0) + '%';
  $('#modal').classList.remove('hidden'); pickSide(side);
}
function pickSide(side) { modalState.side = side; document.querySelectorAll('.sidepick .btn').forEach((b) => b.classList.toggle('sel', b.dataset.side === side)); estimate(); }
function estimate() {
  const { m, side } = modalState; const a = Math.round(Number($('#mAmt').value || 0) * LAMPORTS_PER_SOL);
  if (!(a > 0)) { $('#mEst').textContent = ''; return; }
  const my = (side === 'yes' ? m.yes : m.no) + a, total = m.yes + m.no + a;
  const pay = (a * total) / my;
  $('#mEst').innerHTML = `If <b>${side.toUpperCase()}</b> wins (at current pools): payout ≈ <b>${fmt(pay)}</b> devnet SOL (${(pay / a).toFixed(2)}×). Pools can still move before the end time.`;
}
async function sendTx(ixs) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = walletPk;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  const signed = await wallet.signTransaction(tx);
  const sig = await conn.sendRawTransaction(signed.serialize()); // always sent to devnet RPC
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}
async function confirmBet() {
  const { m, side } = modalState; const a = Math.round(Number($('#mAmt').value) * LAMPORTS_PER_SOL);
  if (!(a >= 1e6)) return status('Minimum bet is 0.001 devnet SOL', 5000);
  $('#mConfirm').disabled = true; $('#mConfirm').textContent = 'Approve in wallet…';
  try {
    const sig = await sendTx([gm.betIx(walletPk, new PublicKey(m.pubkey), side, a)]);
    const hist = JSON.parse(localStorage.getItem('gm_hist') || '[]'); hist.unshift({ sig, id: m.id, side, a, t: Date.now(), q: m.question }); localStorage.setItem('gm_hist', JSON.stringify(hist.slice(0, 50)));
    status(`✅ Bet placed on devnet: ${side.toUpperCase()} ${fmt(a)} SOL · <a href="${exTx(sig)}" target="_blank">view on explorer</a>`, 15000);
    $('#modal').classList.add('hidden'); await loadMarkets(); renderMyBets(); checkWalletNetwork();
  } catch (e) { status('❌ Bet failed: ' + esc(String(e.message || e)) + ' (is your wallet on devnet with enough devnet SOL?)', 12000); }
  finally { $('#mConfirm').disabled = false; $('#mConfirm').textContent = 'Place bet on devnet'; }
}
async function claim(marketPk) {
  try {
    const sig = await sendTx([gm.claimIx(walletPk, new PublicKey(marketPk))]);
    status(`✅ Claimed on devnet · <a href="${exTx(sig)}" target="_blank">view on explorer</a>`, 15000);
    await loadMarkets(); renderMyBets(); checkWalletNetwork();
  } catch (e) { status('❌ Claim failed: ' + esc(String(e.message || e)), 10000); }
}
async function renderMyBets() {
  const el = $('#myBets');
  if (!walletPk) { el.innerHTML = '<p class="muted">Connect a devnet wallet to see your bets.</p>'; return; }
  if (previewMode) { el.innerHTML = '<p class="muted">Preview mode. Betting opens when the program is live on devnet.</p>'; return; }
  el.innerHTML = '<p class="muted">Loading your positions from devnet…</p>';
  try {
    const ps = await gm.fetchPositions(conn, walletPk);
    const rows = ps.map((p) => {
      const m = markets.find((x) => x.pubkey === p.market);
      if (!m) return '';
      const est = gm.expectedPayout(m, p);
      const state = m.outcome === 0 ? (Date.now() / 1000 >= m.endTs ? 'Ended · awaiting resolution' : 'Open') : `Resolved ${OUTCOME[m.outcome]}`;
      const act = m.outcome !== 0 ? `<button class="btn primary" data-claim="${m.pubkey}">${est > 0 ? 'Claim ' + fmt(est) : 'Close position'}</button>` : '';
      return `<tr><td>${esc(m.question)}</td><td>${p.yes ? 'YES ' + fmt(p.yes) : ''}${p.yes && p.no ? '<br>' : ''}${p.no ? 'NO ' + fmt(p.no) : ''}</td><td>${state}</td><td>${act}</td></tr>`;
    }).join('');
    const hist = JSON.parse(localStorage.getItem('gm_hist') || '[]');
    el.innerHTML = `<div class="card mybets-table"><h3 style="margin-top:0">Open positions (devnet, play money)</h3>${rows ? `<table><tr><th>Market</th><th>Stake</th><th>Status</th><th></th></tr>${rows}</table>` : '<p class="muted">No open positions for this wallet. Claimed positions are closed on-chain.</p>'}</div>
      ${hist.length ? `<div class="card" style="margin-top:16px"><h3 style="margin-top:0">Recent bets from this browser</h3><table>${hist.map((h) => `<tr><td>#${h.id} ${esc(h.q)}</td><td>${h.side.toUpperCase()} ${fmt(h.a)}</td><td><a href="${exTx(h.sig)}" target="_blank">tx ↗</a></td></tr>`).join('')}</table></div>` : ''}`;
  } catch (e) { el.innerHTML = `<p class="muted">Couldn't load positions: ${esc(String(e.message || e))}</p>`; }
}

// wiring
$('#connectBtn').onclick = connect;
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-bet]'); if (b && !b.disabled) openModal(Number(b.closest('.mk').dataset.id), b.dataset.bet);
  const c = e.target.closest('[data-claim]'); if (c) claim(c.dataset.claim);
  const t = e.target.closest('.tab'); if (t) { document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t)); ['markets', 'mybets', 'about'].forEach((n) => $('#tab-' + n).classList.toggle('hidden', n !== t.dataset.tab)); if (t.dataset.tab === 'mybets') renderMyBets(); }
  const s = e.target.closest('.sidepick .btn'); if (s) pickSide(s.dataset.side);
  const q = e.target.closest('.quick button'); if (q) { $('#mAmt').value = q.dataset.a; estimate(); }
});
$('#mAmt').oninput = estimate; $('#mConfirm').onclick = confirmBet; $('#modalClose').onclick = () => $('#modal').classList.add('hidden');
$('#progLink').href = exAddr(PROGRAM_ID); $('#progLink').textContent = PROGRAM_ID.slice(0, 6) + '…';
$('#adminLink').href = exAddr(ADMIN); $('#adminLink').textContent = ADMIN.slice(0, 6) + '…';
setInterval(() => document.querySelectorAll('.cd').forEach((el) => (el.textContent = countdown(Number(el.dataset.end)))), 1000);
loadMarkets(); setInterval(loadMarkets, 20000);
