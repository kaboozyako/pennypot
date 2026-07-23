import { ethers } from "ethers";
import type { NextRequest } from "next/server";
import { JACKPOT_ADDRESS } from "@/lib/addresses";
import { getKeeperContract, processRound } from "@/lib/keeper";

// Keeper cron: at :10 past every hour, advance each recently SETTLED Megapot
// round through PennyPot's full fee lifecycle via processRound(round, {credit}):
//   1. claimWinnings  — credits each shareholder's withdrawable `claimable` and
//      transitions losers to "lost" in the UI (otherwise "pending claim" forever).
//   2. snapshotRoundFees — self-sweeps the round's referral fees into the pool
//      and locks a per-share rate (also clears the buyTicket gate).
//   3. creditRoundFees   — credits each holder's `pendingFees` (the "Claim Fees"
//      balance). This is the credit path; the buy keeper only does claim+snapshot.
//
// All three steps are permissionless, batched, gas-buffered, and idempotent
// (already-claimed/credited tickets are skipped, unsettled drawings revert), so
// re-runs are safe. Each settled round is processed independently; partial
// progress (e.g. a round still claiming) just resumes next run.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROUND_LOOKBACK = 3; // scan the last N rounds so late/missed settlements still get swept

const JACKPOT_ABI = [
  "function currentDrawingId() view returns (uint256)",
  "function getDrawingState(uint256 _drawingId) view returns (tuple(uint256 prizePool, uint256 ticketPrice, uint256 edgePerTicket, uint256 referralWinShare, uint256 referralFee, uint256 globalTicketsBought, uint256 lpEarnings, uint256 drawingTime, uint256 winningTicket, uint8 ballMax, uint8 bonusballMax, address payoutCalculator, bool jackpotLock))",
];

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const built = getKeeperContract();
  if ("error" in built) {
    return Response.json({ error: built.error }, { status: 500 });
  }
  const { pennypot, wallet } = built;
  const jackpot = new ethers.Contract(JACKPOT_ADDRESS, JACKPOT_ABI, wallet.provider);

  // currentDrawingId is the OPEN (unsettled) round; settled rounds are below it.
  let currentId: bigint;
  try {
    currentId = (await jackpot.currentDrawingId()) as bigint;
  } catch (e) {
    return Response.json(
      { error: `currentDrawingId failed: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  const rounds: Array<Record<string, unknown>> = [];

  for (let k = 1; k <= ROUND_LOOKBACK; k++) {
    const round = currentId - BigInt(k);
    if (round <= 0n) break;

    let settled = false;
    try {
      const ds = await jackpot.getDrawingState(round);
      settled = (ds.winningTicket as bigint) !== 0n;
    } catch {
      // treat an unreadable drawing as not-yet-settled
    }
    if (!settled) {
      rounds.push({ round: round.toString(), settled: false });
      continue;
    }

    try {
      const result = await processRound(pennypot, round, { credit: true });
      rounds.push({ ...result, settled: true });
    } catch (e) {
      rounds.push({
        round: round.toString(),
        settled: true,
        error: (e as Error).message.split("\n")[0],
      });
    }
  }

  return Response.json({
    action: "processed",
    currentDrawingId: currentId.toString(),
    rounds,
  });
}
