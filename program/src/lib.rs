//! Ghost Markets — DEVNET DEMO, play money only, no real funds.
//! Minimal parimutuel YES/NO prediction market program.
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::Sysvar,
};

entrypoint!(process_instruction);

pub const MARKET_TAG: u8 = 1;
pub const POSITION_TAG: u8 = 2;
pub const MAX_Q: usize = 200;
// tag(1) authority(32) id(8) end_ts(8) yes(8) no(8) outcome(1) bump(1) qlen(2) q(200)
pub const MARKET_SIZE: usize = 1 + 32 + 8 + 8 + 8 + 8 + 1 + 1 + 2 + MAX_Q; // 269
// tag(1) market(32) user(32) yes(8) no(8) claimed(1) bump(1)
pub const POSITION_SIZE: usize = 1 + 32 + 32 + 8 + 8 + 1 + 1; // 83

pub const OUT_OPEN: u8 = 0;
pub const OUT_YES: u8 = 1;
pub const OUT_NO: u8 = 2;
pub const OUT_VOID: u8 = 3;

#[derive(Debug)]
#[repr(u32)]
enum GmError {
    BadInstruction = 6000,
    NotAuthority,
    MarketClosed,
    MarketNotEnded,
    AlreadyResolved,
    NotResolved,
    AlreadyClaimed,
    BadPda,
    QuestionTooLong,
    ZeroAmount,
}
impl From<GmError> for ProgramError {
    fn from(e: GmError) -> Self { ProgramError::Custom(e as u32) }
}

fn rd_u64(d: &[u8], o: usize) -> u64 { u64::from_le_bytes(d[o..o + 8].try_into().unwrap()) }
fn rd_i64(d: &[u8], o: usize) -> i64 { i64::from_le_bytes(d[o..o + 8].try_into().unwrap()) }
fn wr_u64(d: &mut [u8], o: usize, v: u64) { d[o..o + 8].copy_from_slice(&v.to_le_bytes()) }

// market offsets
const M_AUTH: usize = 1;
const M_ID: usize = 33;
const M_END: usize = 41;
const M_YES: usize = 49;
const M_NO: usize = 57;
const M_OUT: usize = 65;
const M_BUMP: usize = 66;
const M_QLEN: usize = 67;
const M_Q: usize = 69;
// position offsets
const P_MARKET: usize = 1;
const P_USER: usize = 33;
const P_YES: usize = 65;
const P_NO: usize = 73;
const P_CLAIMED: usize = 81;
const P_BUMP: usize = 82;

fn create_pda<'a>(
    payer: &AccountInfo<'a>, acct: &AccountInfo<'a>, sys: &AccountInfo<'a>,
    program_id: &Pubkey, size: usize, seeds: &[&[u8]],
) -> ProgramResult {
    let rent = Rent::get()?.minimum_balance(size);
    let cur = acct.lamports();
    if cur == 0 {
        invoke_signed(&system_instruction::create_account(payer.key, acct.key, rent, size as u64, program_id),
            &[payer.clone(), acct.clone(), sys.clone()], &[seeds])?;
    } else {
        // pre-funded griefing guard
        if cur < rent { invoke(&system_instruction::transfer(payer.key, acct.key, rent - cur), &[payer.clone(), acct.clone(), sys.clone()])?; }
        invoke_signed(&system_instruction::allocate(acct.key, size as u64), &[acct.clone(), sys.clone()], &[seeds])?;
        invoke_signed(&system_instruction::assign(acct.key, program_id), &[acct.clone(), sys.clone()], &[seeds])?;
    }
    Ok(())
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let (&ix, rest) = data.split_first().ok_or(GmError::BadInstruction)?;
    let it = &mut accounts.iter();
    let clock = Clock::get()?;
    match ix {
        // CreateMarket: id u64, end_ts i64, qlen u16, q bytes
        // accounts: [authority (signer,w), market (w), system]
        0 => {
            let auth = next_account_info(it)?;
            let market = next_account_info(it)?;
            let sys = next_account_info(it)?;
            if !auth.is_signer { return Err(ProgramError::MissingRequiredSignature); }
            if *sys.key != system_program::ID { return Err(ProgramError::IncorrectProgramId); }
            if rest.len() < 18 { return Err(GmError::BadInstruction.into()); }
            let id = rd_u64(rest, 0);
            let end_ts = rd_i64(rest, 8);
            let qlen = u16::from_le_bytes([rest[16], rest[17]]) as usize;
            if qlen > MAX_Q || rest.len() < 18 + qlen { return Err(GmError::QuestionTooLong.into()); }
            let q = &rest[18..18 + qlen];
            if end_ts <= clock.unix_timestamp { return Err(GmError::MarketClosed.into()); }
            let idb = id.to_le_bytes();
            let (pda, bump) = Pubkey::find_program_address(&[b"market", auth.key.as_ref(), &idb], program_id);
            if pda != *market.key { return Err(GmError::BadPda.into()); }
            if market.owner == program_id { return Err(ProgramError::AccountAlreadyInitialized); }
            create_pda(auth, market, sys, program_id, MARKET_SIZE, &[b"market", auth.key.as_ref(), &idb, &[bump]])?;
            let mut d = market.try_borrow_mut_data()?;
            d[0] = MARKET_TAG;
            d[M_AUTH..M_AUTH + 32].copy_from_slice(auth.key.as_ref());
            wr_u64(&mut d, M_ID, id);
            d[M_END..M_END + 8].copy_from_slice(&end_ts.to_le_bytes());
            d[M_OUT] = OUT_OPEN;
            d[M_BUMP] = bump;
            d[M_QLEN..M_QLEN + 2].copy_from_slice(&(qlen as u16).to_le_bytes());
            d[M_Q..M_Q + qlen].copy_from_slice(q);
            msg!("GhostMarkets: market {} created", id);
            Ok(())
        }
        // PlaceBet: side u8 (1 yes, 2 no), amount u64
        // accounts: [user (signer,w), market (w), position (w), system]
        1 => {
            let user = next_account_info(it)?;
            let market = next_account_info(it)?;
            let pos = next_account_info(it)?;
            let sys = next_account_info(it)?;
            if !user.is_signer { return Err(ProgramError::MissingRequiredSignature); }
            if *sys.key != system_program::ID { return Err(ProgramError::IncorrectProgramId); }
            if market.owner != program_id { return Err(ProgramError::IncorrectProgramId); }
            if rest.len() < 9 { return Err(GmError::BadInstruction.into()); }
            let side = rest[0];
            let amount = rd_u64(rest, 1);
            if amount == 0 { return Err(GmError::ZeroAmount.into()); }
            if side != OUT_YES && side != OUT_NO { return Err(GmError::BadInstruction.into()); }
            {
                let d = market.try_borrow_data()?;
                if d[0] != MARKET_TAG { return Err(ProgramError::InvalidAccountData); }
                if d[M_OUT] != OUT_OPEN { return Err(GmError::AlreadyResolved.into()); }
                if clock.unix_timestamp >= rd_i64(&d, M_END) { return Err(GmError::MarketClosed.into()); }
            }
            let (ppda, pbump) = Pubkey::find_program_address(&[b"pos", market.key.as_ref(), user.key.as_ref()], program_id);
            if ppda != *pos.key { return Err(GmError::BadPda.into()); }
            if pos.owner != program_id {
                create_pda(user, pos, sys, program_id, POSITION_SIZE, &[b"pos", market.key.as_ref(), user.key.as_ref(), &[pbump]])?;
                let mut pd = pos.try_borrow_mut_data()?;
                pd[0] = POSITION_TAG;
                pd[P_MARKET..P_MARKET + 32].copy_from_slice(market.key.as_ref());
                pd[P_USER..P_USER + 32].copy_from_slice(user.key.as_ref());
                pd[P_BUMP] = pbump;
            }
            invoke(&system_instruction::transfer(user.key, market.key, amount), &[user.clone(), market.clone(), sys.clone()])?;
            let mut d = market.try_borrow_mut_data()?;
            let mut pd = pos.try_borrow_mut_data()?;
            if pd[0] != POSITION_TAG { return Err(ProgramError::InvalidAccountData); }
            let (mo, po) = if side == OUT_YES { (M_YES, P_YES) } else { (M_NO, P_NO) };
            let mv = rd_u64(&d, mo).checked_add(amount).ok_or(ProgramError::ArithmeticOverflow)?;
            wr_u64(&mut d, mo, mv);
            let pv = rd_u64(&pd, po).checked_add(amount).ok_or(ProgramError::ArithmeticOverflow)?;
            wr_u64(&mut pd, po, pv);
            msg!("GhostMarkets: bet side={} amount={}", side, amount);
            Ok(())
        }
        // Resolve: outcome u8 (1 yes, 2 no, 3 void)
        // accounts: [authority (signer), market (w)]
        2 => {
            let auth = next_account_info(it)?;
            let market = next_account_info(it)?;
            if !auth.is_signer { return Err(ProgramError::MissingRequiredSignature); }
            if market.owner != program_id { return Err(ProgramError::IncorrectProgramId); }
            let outcome = *rest.first().ok_or(GmError::BadInstruction)?;
            if !(OUT_YES..=OUT_VOID).contains(&outcome) { return Err(GmError::BadInstruction.into()); }
            let mut d = market.try_borrow_mut_data()?;
            if d[0] != MARKET_TAG { return Err(ProgramError::InvalidAccountData); }
            if d[M_AUTH..M_AUTH + 32] != auth.key.to_bytes() { return Err(GmError::NotAuthority.into()); }
            if d[M_OUT] != OUT_OPEN { return Err(GmError::AlreadyResolved.into()); }
            if outcome != OUT_VOID && clock.unix_timestamp < rd_i64(&d, M_END) { return Err(GmError::MarketNotEnded.into()); }
            d[M_OUT] = outcome;
            msg!("GhostMarkets: resolved outcome={}", outcome);
            Ok(())
        }
        // Claim: accounts [user (w, position owner; signer NOT required), market (w), position (w)]
        // Pays pro-rata share and closes the position (rent back to user).
        3 => {
            let user = next_account_info(it)?;
            let market = next_account_info(it)?;
            let pos = next_account_info(it)?;
            // Permissionless crank: anyone may submit; payout always goes to the position's owner.
            if market.owner != program_id || pos.owner != program_id { return Err(ProgramError::IncorrectProgramId); }
            if pos.try_borrow_data()?[P_USER..P_USER + 32] != user.key.to_bytes() { return Err(GmError::BadPda.into()); }
            let (ppda, _) = Pubkey::find_program_address(&[b"pos", market.key.as_ref(), user.key.as_ref()], program_id);
            if ppda != *pos.key { return Err(GmError::BadPda.into()); }
            let payout: u64 = {
                let d = market.try_borrow_data()?;
                let pd = pos.try_borrow_data()?;
                if d[0] != MARKET_TAG || pd[0] != POSITION_TAG { return Err(ProgramError::InvalidAccountData); }
                if pd[P_CLAIMED] != 0 { return Err(GmError::AlreadyClaimed.into()); }
                let out = d[M_OUT];
                if out == OUT_OPEN { return Err(GmError::NotResolved.into()); }
                let (yp, np) = (rd_u64(&d, M_YES) as u128, rd_u64(&d, M_NO) as u128);
                let (uy, un) = (rd_u64(&pd, P_YES) as u128, rd_u64(&pd, P_NO) as u128);
                let total = yp + np;
                let win_pool = match out { OUT_YES => yp, OUT_NO => np, _ => 0 };
                let p = if out == OUT_VOID || win_pool == 0 {
                    uy + un // refund
                } else {
                    let stake = if out == OUT_YES { uy } else { un };
                    stake * total / win_pool
                };
                p as u64
            };
            // move payout from market escrow, keep market rent-exempt
            let min = Rent::get()?.minimum_balance(MARKET_SIZE);
            let avail = market.lamports().saturating_sub(min);
            let pay = payout.min(avail);
            **market.try_borrow_mut_lamports()? -= pay;
            **user.try_borrow_mut_lamports()? += pay;
            // close position: return rent to user
            let pl = pos.lamports();
            **pos.try_borrow_mut_lamports()? = 0;
            **user.try_borrow_mut_lamports()? += pl;
            {
                let mut pd = pos.try_borrow_mut_data()?;
                pd[P_CLAIMED] = 1;
                pd.fill(0);
            }
            pos.assign(&system_program::ID);
            pos.resize(0)?;
            if pay == 0 { msg!("GhostMarkets: nothing to claim (losing side)"); }
            msg!("GhostMarkets: claimed {}", pay);
            Ok(())
        }
        _ => Err(GmError::BadInstruction.into()),
    }
}
