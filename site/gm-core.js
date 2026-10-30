// Ghost Markets client core (browser + node). DEVNET DEMO, play money only.
export const MARKET_SIZE = 269, POSITION_SIZE = 83;
export const OUTCOME = { 0: 'OPEN', 1: 'YES', 2: 'NO', 3: 'VOID' };

const u64le = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
const i64le = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(n), true); return b; };
const cat = (...a) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const enc = new TextEncoder(), dec = new TextDecoder();

export function makeGM(web3, { programId }) {
  const { PublicKey, TransactionInstruction, SystemProgram } = web3;
  const PID = new PublicKey(programId);
  const toBuf = (u8) => (typeof Buffer !== 'undefined' ? Buffer.from(u8) : u8);

  const marketPda = (admin, id) => PublicKey.findProgramAddressSync([enc.encode('market'), new PublicKey(admin).toBytes(), u64le(id)], PID)[0];
  const positionPda = (market, user) => PublicKey.findProgramAddressSync([enc.encode('pos'), new PublicKey(market).toBytes(), new PublicKey(user).toBytes()], PID)[0];

  function decodeMarket(pubkey, data, lamports) {
    const d = new Uint8Array(data), v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    if (d[0] !== 1) return null;
    const qlen = v.getUint16(67, true);
    return {
      pubkey: pubkey.toBase58 ? pubkey.toBase58() : String(pubkey),
      authority: new PublicKey(d.slice(1, 33)).toBase58(),
      id: Number(v.getBigUint64(33, true)),
      endTs: Number(v.getBigInt64(41, true)),
      yes: Number(v.getBigUint64(49, true)),
      no: Number(v.getBigUint64(57, true)),
      outcome: d[65],
      question: dec.decode(d.slice(69, 69 + qlen)),
      lamports,
    };
  }
  function decodePosition(pubkey, data) {
    const d = new Uint8Array(data), v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    if (d[0] !== 2) return null;
    return {
      pubkey: pubkey.toBase58 ? pubkey.toBase58() : String(pubkey),
      market: new PublicKey(d.slice(1, 33)).toBase58(),
      user: new PublicKey(d.slice(33, 65)).toBase58(),
      yes: Number(v.getBigUint64(65, true)),
      no: Number(v.getBigUint64(73, true)),
      claimed: d[81] === 1,
    };
  }
  async function fetchMarkets(conn, admin) {
    const filters = [{ dataSize: MARKET_SIZE }];
    if (admin) filters.push({ memcmp: { offset: 1, bytes: new PublicKey(admin).toBase58() } });
    const accs = await conn.getProgramAccounts(PID, { filters });
    return accs.map((a) => decodeMarket(a.pubkey, a.account.data, a.account.lamports)).filter(Boolean).sort((a, b) => a.id - b.id);
  }
  async function fetchPositions(conn, user) {
    const accs = await conn.getProgramAccounts(PID, { filters: [{ dataSize: POSITION_SIZE }, { memcmp: { offset: 33, bytes: new PublicKey(user).toBase58() } }] });
    return accs.map((a) => decodePosition(a.pubkey, a.account.data)).filter(Boolean);
  }
  async function fetchMarketPositions(conn, market) {
    const accs = await conn.getProgramAccounts(PID, { filters: [{ dataSize: POSITION_SIZE }, { memcmp: { offset: 1, bytes: new PublicKey(market).toBase58() } }] });
    return accs.map((a) => decodePosition(a.pubkey, a.account.data)).filter(Boolean);
  }
  function createMarketIx(admin, id, endTs, question) {
    const q = enc.encode(question);
    if (q.length > 200) throw new Error('question too long (max 200 bytes)');
    const ql = new Uint8Array(2); new DataView(ql.buffer).setUint16(0, q.length, true);
    return new TransactionInstruction({ programId: PID, keys: [
      { pubkey: new PublicKey(admin), isSigner: true, isWritable: true },
      { pubkey: marketPda(admin, id), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ], data: toBuf(cat(Uint8Array.of(0), u64le(id), i64le(endTs), ql, q)) });
  }
  function betIx(user, market, side /* 'yes'|'no' */, lamports) {
    return new TransactionInstruction({ programId: PID, keys: [
      { pubkey: new PublicKey(user), isSigner: true, isWritable: true },
      { pubkey: new PublicKey(market), isSigner: false, isWritable: true },
      { pubkey: positionPda(market, user), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ], data: toBuf(cat(Uint8Array.of(1, side === 'yes' ? 1 : 2), u64le(lamports))) });
  }
  function resolveIx(admin, market, outcome /* 'yes'|'no'|'void' */) {
    const o = { yes: 1, no: 2, void: 3 }[outcome]; if (!o) throw new Error('outcome must be yes|no|void');
    return new TransactionInstruction({ programId: PID, keys: [
      { pubkey: new PublicKey(admin), isSigner: true, isWritable: false },
      { pubkey: new PublicKey(market), isSigner: false, isWritable: true },
    ], data: toBuf(Uint8Array.of(2, o)) });
  }
  // Permissionless: anyone can submit; payout always goes to the position owner.
  function claimIx(user, market) {
    return new TransactionInstruction({ programId: PID, keys: [
      { pubkey: new PublicKey(user), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(market), isSigner: false, isWritable: true },
      { pubkey: positionPda(market, user), isSigner: false, isWritable: true },
    ], data: toBuf(Uint8Array.of(3)) });
  }
  function expectedPayout(m, p) {
    const total = BigInt(m.yes) + BigInt(m.no);
    const win = m.outcome === 1 ? BigInt(m.yes) : m.outcome === 2 ? BigInt(m.no) : 0n;
    if (m.outcome === 0) return null;
    if (m.outcome === 3 || win === 0n) return p.yes + p.no;
    const stake = BigInt(m.outcome === 1 ? p.yes : p.no);
    return Number((stake * total) / win);
  }
  return { PID, marketPda, positionPda, decodeMarket, decodePosition, fetchMarkets, fetchPositions, fetchMarketPositions, createMarketIx, betIx, resolveIx, claimIx, expectedPayout };
}
