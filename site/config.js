// Ghost Markets — DEVNET DEMO, play money only, no real funds.
export const CLUSTER = 'devnet';
export const RPC_URL = 'https://api.devnet.solana.com';
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const PROGRAM_ID = '38SHLP26ucMRRbvWgfqsw7JY7mR8AxnAHD6rowwHEar2';
export const ADMIN = '4cY76TScYbP7gspWiJNXeEvPcQ4rbjWM1RXF6oEXdZfY';
export const FAUCET_URL = 'https://faucet.solana.com/';
// Seed markets (also used as an offline preview if the program is not yet live on devnet)
export const SEEDS = [
  { id: 1, question: 'Will $BOBO trade higher on Nov 1, 2026 (8 PM ET) than at market open (~$0.0055)?', end: '2026-11-01T20:00:00-05:00' },
  { id: 2, question: 'Will $GHOSTDEV hit a $25K market cap by Nov 3, 2026 (11:59 PM ET)?', end: '2026-11-03T23:59:00-05:00' },
  { id: 3, question: 'Will SOL close above $100 on Nov 5, 2026 (UTC daily close)?', end: '2026-11-06T00:00:00Z' },
  { id: 4, question: 'Will the next Flywheel (@flywheelcash) launch bond on pump.fun within 24h of launch?', end: '2026-11-05T23:59:00-05:00' },
  { id: 5, question: 'Will SOL be above $95 at 00:00 UTC on Nov 1, 2026?', end: '2026-11-01T00:00:00Z' },
];
