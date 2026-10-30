#!/usr/bin/env bash
# Ghost Markets: finish the DEVNET launch once the admin keypair holds devnet SOL.
# DEVNET ONLY. Play money only. Never points at mainnet.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."
URL=https://api.devnet.solana.com
KEY="${GM_KEYPAIR:-$HOME/.config/solana/devnet-markets.json}"          # devnet admin keypair (never commit)
PROG_KEY="${GM_PROGRAM_KEYPAIR:-$HOME/.config/solana/ghost-markets-program-devnet.json}"  # program keypair (never commit)
[ "$(solana genesis-hash -u $URL)" = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" ] || { echo "not devnet, abort"; exit 1; }
ADMIN=$(solana-keygen pubkey $KEY)
bal() { solana balance $ADMIN -u $URL --lamports | awk '{print $1}'; }
echo "admin $ADMIN balance: $(bal) lamports (devnet)"
if [ "$(bal)" -lt 1300000000 ]; then
  echo "Need >= 1.3 devnet SOL. Trying the proof-of-work faucet (needs a small starting balance)..."
  devnet-pow mine -k $KEY -u $URL -t 2000000000 || true
fi
[ "$(bal)" -ge 1300000000 ] || { echo "Still under 1.3 devnet SOL. Fund $ADMIN at https://faucet.solana.com (Devnet) and rerun."; exit 1; }
if ! solana program show "$(solana-keygen pubkey $PROG_KEY)" -u $URL >/dev/null 2>&1; then
  solana program deploy program/target/deploy/ghost_markets.so -u $URL -k $KEY --program-id $PROG_KEY --upgrade-authority $KEY --max-len 100000
fi
node scripts/gm.mjs info
node scripts/gm.mjs seed
node scripts/gm.mjs e2e
node scripts/gm.mjs list
node scripts/screenshot.mjs https://ghostmarkets.surge.sh
