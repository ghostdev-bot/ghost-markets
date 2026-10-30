# 👻 Ghost Markets: Solana devnet prediction-market demo

> **Devnet demo only. Play money, no real funds.** There is no mainnet mode, and none should be added without an audit, legal review, and a real oracle.

**Live:** https://ghostmarkets.surge.sh

A tiny pari-mutuel prediction market with a native Rust Solana program (no Anchor) and a static web front end.

- Program: `program/src/lib.rs`. Devnet program ID `38SHLP26ucMRRbvWgfqsw7JY7mR8AxnAHD6rowwHEar2`.
- Site: `site/` (plain HTML/JS, using the `@solana/web3.js` IIFE build).
- Admin CLI: `scripts/gm.mjs`. It checks the genesis hash and refuses to run against mainnet.

## Design
- Market = PDA `["market", admin, id_u64_le]` holding the question, end time, YES/NO pools, and outcome. Bets (devnet SOL) sit in the market PDA as program-owned escrow.
- Position = PDA `["pos", market, user]` with the user's YES/NO stake.
- Instructions: `0 CreateMarket` (admin), `1 PlaceBet` (before end), `2 Resolve yes|no|void` (admin, after end; void any time), `3 Claim` (permissionless crank: pays `stake * total / winning_pool`, closes the position, and refunds its rent). VOID, or a winning side with zero stake, refunds everyone.
- No fees.

## Run
```bash
npm install
npm run serve                       # copies the web3.js IIFE into site/ and serves it on :8077
```

Build the program with the Solana toolchain:
```bash
cd program && cargo-build-sbf
```

Admin CLI (devnet only):
```bash
export GM_KEYPAIR=~/.config/solana/devnet-markets.json   # your devnet admin keypair (never commit it)
node scripts/gm.mjs info
node scripts/gm.mjs list
node scripts/gm.mjs create --question "Will SOL close above \$100 on Nov 5?" --end 2026-11-05T20:00:00-05:00
node scripts/gm.mjs resolve --id 6 --outcome yes   # yes | no | void
node scripts/gm.mjs payout  --id 6
node scripts/gm.mjs e2e                            # full on-chain test with 2 generated throwaway wallets
```

| Env var | Purpose |
| --- | --- |
| `GM_KEYPAIR` | Path to the devnet admin keypair (default `~/.config/solana/devnet-markets.json`). |
| `GM_PROGRAM_KEYPAIR` | Program keypair used by `scripts/go-live.sh` to deploy. |
| `GM_FORBIDDEN_KEYS` | Optional comma-separated keypair paths the CLI must refuse to load. |

The `e2e` command writes throwaway wallets to `test-wallets/`, which is git-ignored.

UI test against a local validator: start `solana-test-validator`, deploy the program, serve `site/` on :8077, then run `node scripts/ui-test.mjs`.

## License
MIT
