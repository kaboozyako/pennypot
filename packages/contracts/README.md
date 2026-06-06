# PennyPot

Buy 1¢ shares of Megapot lottery tickets. 1 share = 1% of that ticket's prize.
The pool keeps zero winnings, and Megapot's referral fees (per-purchase + per-win) are
passed through to players — each round's fees are split among that round's shareholders.

This package contains:

- `src/PennyPot.sol` — the main contract
- `src/interfaces/IJackpot.sol` — minimal interface to Megapot's Jackpot (reads + claims)
- `src/interfaces/IRandomTicketBuyer.sol` — interface to Megapot's quick-pick buyer

Tests are in `test/`, with `MockJackpot`, `MockRandomTicketBuyer`, and `MockUSDC` for unit
testing, and a deploy script in `script/Deploy.s.sol`.

## Design: ticket-keyed, drawing-agnostic

PennyPot does **not** track drawing lifecycle on-chain. Drawings are indexed
off-chain, and Megapot itself is the source of truth for settlement — its
`claimWinnings` reverts until a ticket's drawing has settled. The contract is a
thin ledger keyed by the **Megapot ticket ID**:

- `soldOf[ticketId]` — shares sold (0..100)
- `shares[ticketId][user]` — share ownership
- `winningsPerShareOf[ticketId]` — set on claim; `tierPayout / sharesSold`
- `claimedOf[ticketId]` — settled-against-Megapot flag

A single active-ticket pointer (`activeTicketId` + `activeDeadline`) drives selling.
A `drawingId => ticketId[]` index is kept **only** as a read convenience
(`getDrawingTicketIds`); it never gates contract logic.

## Mechanic in one diagram

```
Reserve (seeded by operator)
    │
    │ −$1 (fronts ticket)
    ▼
buyTicket() ──► RandomTicketBuyer.buyTickets(count=1, recipient=PennyPot,
                                       referrer=PennyPot (self), split=[1e18],
                                       source=keccak256("pennypot"))
                                        │
                                        │ picks numbers, mints quick-pick NFT to PennyPot
                                        │ accrues referral fee to PennyPot's own balance
                                        ▼
                            activeTicketId = #N (selling shares until activeDeadline)
                                        │
                                        │ 100 × buyTicketShares(#N, ...) at 1¢ each
                                        │ each +1¢ → reserve
                                        ▼
                            #N full → anyone cranks buyTicket() again
                                        ⋮ (rolls within the drawing, then into the next)

Megapot settles (winningTicket != 0):
  claimWinnings([ticketIds])
    Skip losers (Megapot reverts on tier 0/2); for each winner:
    Jackpot.claimWinnings([id]), measure USDC delta,
    set winningsPerShare = ticketWin / sharesSold
    (undersubscribed tickets amplify per-share payout; any 0-share win
     or rounding dust is credited to the reserve, not stranded)

    claimWinnings also credits each winner's shareholders: claimable[holder] += shares × wps

Users:
  withdraw()
    Sends the caller's whole claimable balance in one transfer. No ticket ids:
    read claimable(addr) for the balance.
```

## Key design decisions (locked in)

| Choice | Decision |
|---|---|
| Share price | 1¢ (10_000 USDC, 6-decimal) |
| Shares per ticket | 100 |
| Reserve seed | by owner via `depositReserve` |
| Reserve withdrawable | Yes, by owner (capped at `reservePool`) |
| Reserve drained behavior | `buyTicket` reverts; selling halts gracefully |
| Per-wallet share cap | None (whales welcome) |
| Win payout rule | `tierPayout / sharesActuallySold` per ticket (undersubscription amplifies) |
| Pool's cut of winnings | Zero |
| Revenue model | Megapot referral fees passed through to players (per-round, by shares) |
| Referral split | single 100% referrer = PennyPot itself, `[1e18]` (Megapot's 1e18 scale) |
| Source tag | `keccak256("pennypot")` |
| Referrer | PennyPot refers its own tickets (Megapot imposes no recipient ≠ referrer rule — verified on-chain) |
| Drawing lifecycle on-chain | **None** — keyed off Megapot ticket IDs; drawings indexed off-chain |
| Settlement crank | `claimWinnings([ticketIds])`, permissionless; gated by Megapot, not internal state |
| MIN_SELLING_WINDOW | 1 hour before drawing close |
| Claim pattern | Permissionless `claimWinnings` credits balances; user-pulled `withdraw()` |
| Upgradeability | None — redeploy if needed |

## Functions

### Users

- `buyTicketShares(uint256 expectedTicketId, uint8 count)` — buy 1..N shares of the active
  ticket for yourself. `expectedTicketId` guards against the active ticket rolling over
  between submit and execution.
- `buyTicketSharesFor(uint256 expectedTicketId, uint8 count, address recipient)` — gift
  shares: same as `buyTicketShares`, but the shares are credited to (and claimable only
  by) `recipient` while USDC is still pulled from the caller. `recipient` must be non-zero.
- `withdraw()` — pull the caller's entire credited winnings balance (no ticket ids).
- `withdrawFees()` — pull the caller's entire credited referral-fee balance (the "Claim
  Fees" action). Read `pendingFees(addr)`.

### Permissionless cranks

- `buyTicket()` — front + buy the next Megapot ticket (into the current drawing);
  allowed only when the active ticket is full or its drawing's window has ended.
- `claimWinnings(uint256[] ticketIds)` — settle tickets: skip losers, claim winners from
  Megapot, set each `winningsPerShare`. Permissionless, idempotent; each ticket gated on
  its own drawing's settlement (via `ticketDrawingId`).
- `sweepReferralFees()` — claim PennyPot's accrued Megapot referral fees (purchase fees +
  win shares, since PennyPot refers its own tickets) into `feePool`. Permissionless; a no-op
  (returns 0) when nothing has accrued — guards Megapot's revert-on-zero-balance.
- `snapshotRoundFees(uint256 drawingId)` — fix a closed round's fee-per-share
  (`feePool / total shares sold`) and drain that amount from `feePool`. Once per round.
- `creditRoundFees(uint256[] ticketIds)` — credit each ticket's holders their round fee
  into `feesClaimable`. Batchable; idempotent per ticket.

  Keeper cadence per round (hourly, after the round settles, in order):
  `claimWinnings → sweepReferralFees → snapshotRoundFees → creditRoundFees`.

### Owner

Ownership and pause are OpenZeppelin's `Ownable2Step` + `Pausable`.

- `depositReserve(uint256 amount)` — deposit USDC into the reserve (seed/replenish).
- `withdrawReserve(uint256 amount, address to)` — pull from reserve (capped at `reservePool`).
- `pause() / unpause()` — emergency stop on writes (OZ `Pausable`).
- `transferOwnership(address) / acceptOwnership()` — two-step handoff (OZ `Ownable2Step`);
  also `renounceOwnership()`.

### Reads (for UI)

- `getState()` → `(currentDrawingId, currentTicketId, sold, deadline, canBuyNextTicket,
  reserve, isPaused)` — one-call dashboard snapshot; `canBuyNextTicket` mirrors
  `buyTicket()`'s guards.
- `getTicket(ticketId)` → `(shares, holders, winningsPerShare, claimed)`.
- `getTicketShares(ticketId, addr)` — one holder's share count.
- `getTicketHolders(ticketId)` → `(address[] holders, uint8[] shareCounts)` — the
  per-ticket cap table (share count = %, bounded to 100 entries). The owner *count* is
  also available directly from `getTicket(ticketId).holderCount`.
- `getDrawingTicketIds(drawingId)`, `getDrawingTicketCount(drawingId)` — enumerate a
  drawing's tickets without an off-chain index.
- `ticketDrawingId(ticketId)` — the drawing a ticket was bought into.
- `balance(addr)` / `claimable(addr)` — the user's total withdrawable winnings (O(1)).
- `pendingFees(addr)` / `feesClaimable(addr)` — the user's total withdrawable referral fees.

## Reserve economics

Per ticket:

| Subscription | Reserve out | Reserve in | Net reserve | Players (referral) |
|---|---|---|---|---|
| 100% (full) | −$1.00 | +$1.00 | $0 | + referral fee, split by shares |
| 50% (half) | −$1.00 | +$0.50 | −$0.50 | + referral fee, split by shares |
| 0% (empty) | −$1.00 | $0 | −$1.00 | + referral fee (no shares → rolls forward) |

Within one drawing only the **last partially-sold ticket** can be undersubscribed
(all prior tickets were 100% sold to trigger the next purchase). So the reserve's
worst-case loss per drawing is bounded by **$0.90** (one ticket, ≤10% sold, no win).

With wins, winnings flow to shareholders (not the reserve). Megapot's referral fees (per
purchase + per win) are swept in via `sweepReferralFees()` — PennyPot refers its own tickets,
so the fees accrue to PennyPot itself — and split among each round's shareholders by shares,
claimable with `withdrawFees()`.

## Deployment

The deploy script defaults to Base mainnet; override any value via env vars. PennyPot refers
its own tickets, so there is no separate referrer wallet/contract to deploy or wire.

```bash
# from packages/contracts
forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --broadcast --verify
```

Constructor args (`PennyPot(_usdc, _jackpot, _randomBuyer, _owner)`):

- `_usdc` = `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (USDC on Base)
- `_jackpot` = `0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2` (Megapot Jackpot — reads + claims)
- `_randomBuyer` = `0xb9560b43b91dE2c1DaF5dfbb76b2CFcDaFc13aBd` (Megapot RandomTicketBuyer —
  quick-pick purchases)
- `_owner` = admin wallet (reserve mgmt + pause)

Then seed the reserve from the owner: `USDC.approve(pennyPot, amount)` then
`pennyPot.depositReserve(amount)`.

### Keeper loop (poll ~every 30 min)

- If there's no active ticket, or the active ticket is full, or its drawing window has
  ended (and reserve ≥ $1, and we're > MIN_SELLING_WINDOW from close): call `buyTicket()`.
- After a drawing settles on Megapot (`winningTicket != 0`): call
  `claimWinnings(getDrawingTicketIds(drawingId))` to settle that drawing's tickets, then
  pass its referral fees to holders — `sweepReferralFees()` → `snapshotRoundFees(drawingId)`
  → `creditRoundFees(getDrawingTicketIds(drawingId))` (chunk the ticket ids if the round is
  large). Run this once per round, in order.

## Testing

```bash
# Install Foundry: https://book.getfoundry.sh
git submodule update --init --recursive   # forge-std
forge test -vv
```

## Known limitations

- **`ticketPrice` change on Megapot bricks the contract.** `buyTicket` reverts if
  `Jackpot.ticketPrice() != 1 USDC`. If Megapot governance changes this, redeploy.
- **No on-chain "drawings I've participated in".** By design — reconstruct user history
  off-chain from `SharesBought` / `TicketBought` events (indexed). `SharesBought` is
  `(uint256 indexed ticketId, address indexed holder, address payer, uint8 count, uint8 newSold)`
  — filter by `holder` for "shares I own" (gifts surface for the recipient); `payer` is
  the funding address when shares were gifted.

## Security notes

- PennyPot refers its own tickets, so referral fees accrue to PennyPot itself and are swept
  in by the permissionless `sweepReferralFees()` (guarded against Megapot's revert-on-zero).
  There is no separate referrer wallet that could be lost or withhold fees.
- `owner` can pause writes and pull reserve surplus, but **cannot** touch user winnings or
  referral fees — `withdrawReserve` is bounded by `reservePool`, which tracks only reserve
  funds (not pending winnings, `feePool`, or `feesClaimable`).
- `claimWinnings` is permissionless and idempotent. Anyone can crank it.
- Ownership is OZ `Ownable2Step` — two-step (start + accept) to prevent typo-bricking.
- No reentrancy guards — state changes precede external USDC/Megapot calls (or follow
  them on safe internal arithmetic). USDC on Base is non-reentrant; re-check if forking.
```
