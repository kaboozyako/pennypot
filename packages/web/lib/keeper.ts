import "server-only";
import { ethers } from "ethers";
import { PENNYPOT_ADDRESS } from "./addresses";

// Server-only keeper helper: front the next Megapot ticket if PennyPot reports
// it's currently buyable. Shared by the backstop cron (/api/cron/buy-ticket)
// and the push-on-fill trigger (/api/keeper/buy-ticket). The `import
// "server-only"` guard makes this module throw if it's ever pulled into a
// client bundle (it touches KEEPER_PK).
//
// Gas policy: buyTicket()'s real cost swings (~1.04M–1.2M+) with Megapot state
// (Pyth entropy request, drawing-rollover init, LP accounting), and the bare
// eth_estimateGas has under-provisioned and run OUT OF GAS — which also loops,
// since an OOG'd buy never fronts the ticket so canBuyNextTicket stays true and
// the cron keeps retrying. So we estimate, then set gasLimit to estimate +60%.
// EIP-1559 fees are still left to ethers (getFeeData()); unused gas is refunded,
// so the headroom is effectively free insurance.

const BASE_CHAIN_ID = 8453;
const GAS_BUFFER_BPS = 160n; // buyTicket gasLimit = estimate * 1.60 (swingy cost)
const CLAIM_GAS_BUFFER_BPS = 130n; // claim/snapshot/credit gasLimit = estimate * 1.30
const GAS_CEILING = 3_000_000n; // abort only if the estimate is pathological
const MAX_ROUND_BATCH = 40; // cap tickets per claim/credit tx to bound gas

const PENNYPOT_KEEPER_ABI = [
  "function getState() view returns (uint256 currentDrawingId, uint256 currentTicketId, uint8 sold, uint64 deadline, bool canBuyNextTicket, uint256 reserve, bool isPaused)",
  "function buyTicket()",
  "function lastDrawingBought() view returns (uint256)",
  "function getDrawingTicketIds(uint256 drawingId) view returns (uint256[])",
  "function getTicket(uint256 ticketId) view returns (uint8 shares, uint8 holders, uint256 winningsPerShare, bool claimed)",
  "function claimWinnings(uint256[] ticketIds)",
  "function snapshotRoundFees(uint256 drawingId)",
  "function creditRoundFees(uint256[] ticketIds)",
  "function roundSnapshotted(uint256) view returns (bool)",
  "function ticketFeesCredited(uint256) view returns (bool)",
];

export type KeeperResult = { action: string; [key: string]: unknown };

export function resolveRpcUrl(): string | undefined {
  const explicit =
    process.env.BASE_RPC_URL || process.env.NEXT_PUBLIC_BASE_RPC_URL;
  if (explicit) return explicit;
  const key =
    process.env.ALCHEMY_API_KEY || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  return key ? `https://base-mainnet.g.alchemy.com/v2/${key}` : undefined;
}

// Build a write-enabled PennyPot contract bound to the keeper wallet, or return
// an error result. Shared by the buy keeper and the claim-winnings cron so both
// use the same RPC resolution, ABI, and KEEPER_PK guard.
export function getKeeperContract():
  | { pennypot: ethers.Contract; wallet: ethers.Wallet }
  | { error: string } {
  const rpcUrl = resolveRpcUrl();
  if (!rpcUrl) {
    return { error: "no RPC configured (set ALCHEMY_API_KEY or BASE_RPC_URL)" };
  }
  const pk = process.env.KEEPER_PK;
  if (!pk) return { error: "KEEPER_PK not set" };

  const provider = new ethers.JsonRpcProvider(rpcUrl, BASE_CHAIN_ID);
  const wallet = new ethers.Wallet(pk, provider);
  const pennypot = new ethers.Contract(
    PENNYPOT_ADDRESS,
    PENNYPOT_KEEPER_ABI,
    wallet,
  );
  return { pennypot, wallet };
}

// estimate gas for a contract method, abort if pathological, else apply buffer.
async function bufferedGasLimit(
  method: { estimateGas: (...args: unknown[]) => Promise<bigint> },
  args: unknown[],
  bps: bigint,
): Promise<bigint> {
  const est = await method.estimateGas(...args);
  if (est > GAS_CEILING) {
    throw new Error(
      `gas estimate ${est.toString()} exceeds ceiling ${GAS_CEILING.toString()}`,
    );
  }
  return (est * bps) / 100n;
}

// Advance one (closed) round through its fee lifecycle, each step gas-buffered
// and idempotent/guarded:
//   1. claimWinnings on any unclaimed tickets (settles the round's win shares).
//   2. snapshotRoundFees once all claimed (self-sweeps referral fees into the
//      pool, locks a per-share rate, DRAINS the pool) — this unblocks buyTicket.
//   3. if `credit`: creditRoundFees in batches (credits each holder's pendingFees).
// Each tx is batched to MAX_ROUND_BATCH; partial progress returns and the next
// run continues. The buyTicket gate guarantees at most one such round at a time.
export async function processRound(
  pennypot: ethers.Contract,
  drawingId: bigint,
  opts: { credit: boolean },
): Promise<KeeperResult> {
  const result: KeeperResult = { action: "processRound", drawingId: drawingId.toString() };

  const ids = (await pennypot.getDrawingTicketIds(drawingId)) as bigint[];
  if (ids.length === 0) {
    result.note = "no tickets in round";
    return result;
  }

  // 1. Claim any unclaimed tickets first (their win shares must accrue before snapshot).
  const unclaimed: bigint[] = [];
  for (const id of ids) {
    const t = await pennypot.getTicket(id);
    if (!t.claimed) unclaimed.push(id);
  }
  if (unclaimed.length > 0) {
    const batch = unclaimed.slice(0, MAX_ROUND_BATCH);
    try {
      const gasLimit = await bufferedGasLimit(
        pennypot.claimWinnings,
        [batch],
        CLAIM_GAS_BUFFER_BPS,
      );
      const tx = await pennypot.claimWinnings(batch, { gasLimit });
      const receipt = await tx.wait(1);
      result.claimed = {
        count: batch.length,
        remaining: unclaimed.length - batch.length,
        txHash: tx.hash,
        blockNumber: receipt?.blockNumber ?? null,
      };
    } catch (e) {
      // Drawing may not be settled yet on Megapot — soft-skip, retry next run.
      result.claimError = (e as Error).message.split("\n")[0];
      return result;
    }
    // Can't snapshot until EVERY ticket is claimed; finish remaining next run.
    if (unclaimed.length > batch.length) {
      result.note = "more unclaimed tickets remain; continuing next run";
      return result;
    }
  }

  // 2. Snapshot the round's referral fees (drains feePool → per-share rate). This
  //    is what clears the buyTicket gate for the next drawing.
  const snapped = (await pennypot.roundSnapshotted(drawingId)) as boolean;
  if (!snapped) {
    try {
      const gasLimit = await bufferedGasLimit(
        pennypot.snapshotRoundFees,
        [drawingId],
        CLAIM_GAS_BUFFER_BPS,
      );
      const tx = await pennypot.snapshotRoundFees(drawingId, { gasLimit });
      const receipt = await tx.wait(1);
      result.snapshotted = { txHash: tx.hash, blockNumber: receipt?.blockNumber ?? null };
    } catch (e) {
      result.snapshotError = (e as Error).message.split("\n")[0];
      return result;
    }
  } else {
    result.snapshotted = "already";
  }

  // 3. (credit path) credit each holder's pendingFees, in batches.
  if (opts.credit) {
    const uncredited: bigint[] = [];
    for (const id of ids) {
      const done = (await pennypot.ticketFeesCredited(id)) as boolean;
      if (!done) uncredited.push(id);
    }
    if (uncredited.length > 0) {
      const batch = uncredited.slice(0, MAX_ROUND_BATCH);
      try {
        const gasLimit = await bufferedGasLimit(
          pennypot.creditRoundFees,
          [batch],
          CLAIM_GAS_BUFFER_BPS,
        );
        const tx = await pennypot.creditRoundFees(batch, { gasLimit });
        const receipt = await tx.wait(1);
        result.credited = {
          count: batch.length,
          remaining: uncredited.length - batch.length,
          txHash: tx.hash,
          blockNumber: receipt?.blockNumber ?? null,
        };
      } catch (e) {
        result.creditError = (e as Error).message.split("\n")[0];
      }
    } else {
      result.credited = "all";
    }
  }

  return result;
}

type StateMeta = {
  drawingId: string;
  activeTicketId: string;
  sold: number;
  reserve: string;
};

function readMeta(state: ethers.Result): StateMeta {
  return {
    drawingId: (state.currentDrawingId as bigint).toString(),
    activeTicketId: (state.currentTicketId as bigint).toString(),
    sold: Number(state.sold as bigint),
    reserve: (state.reserve as bigint).toString(),
  };
}

// Estimate + buffer + send buyTicket. Returns a "bought" result, or a soft
// "skip" if it would revert right now.
async function executeBuy(
  pennypot: ethers.Contract,
  meta: StateMeta,
): Promise<KeeperResult> {
  let gasLimit: bigint;
  try {
    gasLimit = await bufferedGasLimit(pennypot.buyTicket, [], GAS_BUFFER_BPS);
  } catch (e) {
    return {
      action: "skip",
      reason: `buyTicket would revert: ${(e as Error).message.split("\n")[0]}`,
      ...meta,
    };
  }
  try {
    const tx = await pennypot.buyTicket({ gasLimit });
    const receipt = await tx.wait(1);
    return {
      action: "bought",
      txHash: tx.hash,
      gasLimit: gasLimit.toString(),
      blockNumber: receipt?.blockNumber ?? null,
      gasUsed: receipt?.gasUsed?.toString() ?? null,
      ...meta,
    };
  } catch (e) {
    return { action: "error", error: (e as Error).message, ...meta };
  }
}

export async function maybeBuyNextTicket(): Promise<KeeperResult> {
  const built = getKeeperContract();
  if ("error" in built) return { action: "error", error: built.error };
  const { pennypot } = built;

  // canBuyNextTicket already simulates buyTicket()'s full guard set (pause,
  // active-ticket-closed, price match, selling window, reserve, AND the new
  // per-round snapshot gate).
  let state: ethers.Result;
  try {
    state = (await pennypot.getState()) as ethers.Result;
  } catch (e) {
    return { action: "error", error: `getState failed: ${(e as Error).message}` };
  }
  const canBuy = state.canBuyNextTicket as boolean;
  const paused = state.isPaused as boolean;
  const currentDrawingId = state.currentDrawingId as bigint;
  const meta = readMeta(state);

  if (paused) return { action: "skip", reason: "paused", ...meta };
  if (canBuy) return executeBuy(pennypot, meta);

  // Not buyable. The most common reason at a drawing boundary is the snapshot
  // gate: the prior participated round closed but hasn't been snapshotted yet,
  // so buyTicket reverts PriorRoundNotSnapshotted. Resolve it inline (claim +
  // snapshot — enough to clear the gate; fee crediting happens in the cron),
  // then re-read state and buy. This avoids a boundary gap where no ticket is
  // active. Any other !canBuy reason (reserve/window) falls through to a skip.
  let lastDrawingBought: bigint;
  let priorSnapshotted: boolean;
  try {
    lastDrawingBought = (await pennypot.lastDrawingBought()) as bigint;
    priorSnapshotted =
      lastDrawingBought === 0n
        ? true
        : ((await pennypot.roundSnapshotted(lastDrawingBought)) as boolean);
  } catch (e) {
    return { action: "error", error: `gate read failed: ${(e as Error).message}`, ...meta };
  }

  const gateBlocking =
    lastDrawingBought !== 0n &&
    lastDrawingBought !== currentDrawingId &&
    !priorSnapshotted;

  if (!gateBlocking) {
    return { action: "skip", reason: "cannot buy next ticket yet", ...meta };
  }

  // Settle + snapshot the prior round to unblock the gate.
  const rd = await processRound(pennypot, lastDrawingBought, { credit: false });
  if (!rd.snapshotted) {
    // Snapshot didn't land this run (e.g. drawing not settled yet, or more
    // tickets to claim) — report progress; the next tick/push will continue.
    return { action: "gate-pending", round: rd, ...meta };
  }

  // Re-read state now that the gate should be clear, then buy.
  let state2: ethers.Result;
  try {
    state2 = (await pennypot.getState()) as ethers.Result;
  } catch (e) {
    return { action: "error", error: `getState (post-gate) failed: ${(e as Error).message}`, round: rd };
  }
  const meta2 = readMeta(state2);
  if (state2.isPaused as boolean) {
    return { action: "skip", reason: "paused", round: rd, ...meta2 };
  }
  if (!(state2.canBuyNextTicket as boolean)) {
    return { action: "gate-cleared", reason: "still not buyable", round: rd, ...meta2 };
  }
  const buy = await executeBuy(pennypot, meta2);
  return { ...buy, round: rd };
}
