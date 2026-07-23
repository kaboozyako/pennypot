# @pennypot/web

Single-page Next.js (app router) + wagmi v2 + ConnectKit dApp for the live
[PennyPot](https://basescan.org/address/0xdCc075040Cf5888dBa26E9871427949BAb7591ba)
deployment on Base.

## Local dev

```bash
# from packages/web
cp .env.example .env.local         # set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
pnpm install                        # (or `npm install`)
pnpm dev                            # http://localhost:3000
```

Wallet stack: **ConnectKit** drives the connect modal on top of wagmi v2. The
default wallet set covers **Injected** (any EIP-6963 browser-extension wallet —
MetaMask, Rabby, Brave, Phantom EVM, etc., auto-detected), **Coinbase Wallet**
(extension + Smart Wallet passkey flow on mobile), **WalletConnect** (Rainbow /
Trust / etc. mobile via QR or deep link), and **Safe**. Without a WC project id,
WC-based wallets won't connect; the rest still work.

The only **required** env var for the full wallet set is a free
[WalletConnect Cloud](https://cloud.walletconnect.com/) project id, set as
`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.

## Deploying to Vercel

1. Push the monorepo to GitHub.
2. In Vercel: **New Project → Import repo →** set **Root Directory** to
   `packages/web` (so Vercel runs the build from this package, not the repo root).
3. Framework preset is auto-detected as Next.js. Default build command (`next build`)
   and output (`/.next`) are correct.
4. Set environment variables (Production + Preview):
   - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (required for WC-based mobile wallets)
   - `NEXT_PUBLIC_ALCHEMY_API_KEY` (recommended — routes all frontend RPC through
     `https://base-mainnet.g.alchemy.com/v2/<key>`; the public RPC will rate-limit)
   - `NEXT_PUBLIC_BASE_RPC_URL` (optional — full URL override for non-Alchemy providers)
   - `NEXT_PUBLIC_PENNYPOT_DEPLOY_BLOCK` (optional — set to PennyPot's exact creation
     block for faster log queries on the "My positions" section)
5. Deploy. That's the whole flow — no extra Vercel config needed.

## What's on the page

One route, four sections:

- **Hero** — current drawing, active ticket `#N`, shares `Y/100`, time-to-close,
  total tickets fronted this drawing, reserve balance. Updates every 15s.
- **Buy** — `1¢ × [count]` shares input. Checks USDC allowance first; only shows
  the approve button when needed. Submits `buyTicketShares(expectedTicketId, count)`
  — the `expectedTicketId` guards against the active ticket rolling over between
  submit and execution.
- **My positions** — your total `claimable(addr)` balance + a single `Withdraw`
  button (pays your whole balance across all settled tickets in one tx). The
  per-ticket history beneath is reconstructed from `SharesBought` event logs.
- **Cranks** — `buyTicket()` (front the next ticket) and `claimWinnings(ids[])`
  (settle the previous drawing's tickets). Permissionless; you only pay gas.

## Spec deltas worth knowing

The original product spec targeted an older PennyPot API; the deployed contract
landed with a simpler ticket-keyed model after several refactors. This webapp
matches the deployed contract:

| Spec | Deployed (used here) |
|---|---|
| `getDrawing(drawingId)` | `getState()` — one-call snapshot |
| `getTicket(drawingId, idx)` | `getTicket(ticketId)` |
| `getMyShares(drawingId, idx, addr)` | `getTicketShares(ticketId, addr)` |
| `getPendingWinnings(drawingId, addr)` | `balance(addr)` / `claimable(addr)` (O(1)) |
| `buyShares(drawingId, count)` | `buyTicketShares(expectedTicketId, count)` |
| `withdrawWinnings(drawingId)` | `withdraw()` (no args; pays full balance) |
| `buyNextTicket(drawingId)` crank | `buyTicket()` |
| `finalizeDrawing(drawingId)` crank | — (removed; not needed) |
| `claimDrawing(drawingId)` crank | `claimWinnings(uint256[] ticketIds)` |

Consequence: **Positions is much simpler** (one balance + one Withdraw button,
not per-drawing), and **Cranks has two buttons instead of three** (no `finalize`).

## Other decisions

- **Accent color: hot pink** (`#ff2d88`) on a near-black canvas, JetBrains-style
  mono for amounts, faint CRT-scanline overlay. Penny-arcade vibe.
- **Polling** uses wagmi `refetchInterval: 15s` for state and 30s for less-volatile
  reads; the second-precision countdown is driven by a local `setInterval` so the
  UI doesn't depend on RPC freshness.
- **Buying window in the last hour** — `buyTicket` is blocked within
  `MIN_SELLING_WINDOW` (1h) of close, but `buyTicketShares` on an already-active
  ticket keeps working right up to the deadline. The UI handles both states.
- **No write happens without showing the user the exact USDC amount** — the Buy
  button label always carries the cost.
- **ABIs** are hand-extracted into `lib/abis.ts` (only what the webapp uses).

## Out of scope (per spec, V1)

Multi-drawing history beyond current + previous, leaderboards, push notifications,
token gating.
