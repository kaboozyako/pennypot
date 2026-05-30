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
const GAS_BUFFER_BPS = 160n; // gasLimit = estimate * 1.60
const GAS_CEILING = 3_000_000n; // abort only if the estimate is pathological

const PENNYPOT_KEEPER_ABI = [
  "function getState() view returns (uint256 currentDrawingId, uint256 currentTicketId, uint8 sold, uint64 deadline, bool canBuyNextTicket, uint256 reserve, bool isPaused)",
  "function buyTicket()",
];

export type KeeperResult = { action: string; [key: string]: unknown };

function resolveRpcUrl(): string | undefined {
  const explicit =
    process.env.BASE_RPC_URL || process.env.NEXT_PUBLIC_BASE_RPC_URL;
  if (explicit) return explicit;
  const key =
    process.env.ALCHEMY_API_KEY || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  return key ? `https://base-mainnet.g.alchemy.com/v2/${key}` : undefined;
}

export async function maybeBuyNextTicket(): Promise<KeeperResult> {
  const rpcUrl = resolveRpcUrl();
  if (!rpcUrl) {
    return {
      action: "error",
      error: "no RPC configured (set ALCHEMY_API_KEY or BASE_RPC_URL)",
    };
  }
  const pk = process.env.KEEPER_PK;
  if (!pk) return { action: "error", error: "KEEPER_PK not set" };

  const provider = new ethers.JsonRpcProvider(rpcUrl, BASE_CHAIN_ID);
  const wallet = new ethers.Wallet(pk, provider);
  const pennypot = new ethers.Contract(
    PENNYPOT_ADDRESS,
    PENNYPOT_KEEPER_ABI,
    wallet,
  );

  // canBuyNextTicket already simulates buyTicket()'s full guard set (pause,
  // active-ticket-closed, price match, selling window, reserve).
  let state: ethers.Result;
  try {
    state = (await pennypot.getState()) as ethers.Result;
  } catch (e) {
    return { action: "error", error: `getState failed: ${(e as Error).message}` };
  }
  const canBuy = state.canBuyNextTicket as boolean;
  const paused = state.isPaused as boolean;
  const meta = {
    drawingId: (state.currentDrawingId as bigint).toString(),
    activeTicketId: (state.currentTicketId as bigint).toString(),
    sold: Number(state.sold as bigint),
    reserve: (state.reserve as bigint).toString(),
  };

  if (paused || !canBuy) {
    return {
      action: "skip",
      reason: paused ? "paused" : "cannot buy next ticket yet",
      ...meta,
    };
  }

  // Estimate, then buffer the gasLimit. A revert during estimation means
  // buyTicket() would revert right now — treat as a soft skip.
  let gasLimit: bigint;
  try {
    const est = await pennypot.buyTicket.estimateGas();
    if (est > GAS_CEILING) {
      return {
        action: "abort",
        reason: `gas estimate ${est.toString()} exceeds ceiling ${GAS_CEILING.toString()}`,
        ...meta,
      };
    }
    gasLimit = (est * GAS_BUFFER_BPS) / 100n;
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
