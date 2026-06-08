"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useReadContracts,
} from "wagmi";
import { base } from "wagmi/chains";
import { erc20Abi, jackpotAbi, payoutCalculatorAbi, pennypotAbi } from "./abis";
import {
  JACKPOT_ADDRESS,
  PENNYPOT_ADDRESS,
  PENNYPOT_DEPLOY_BLOCK,
  USDC_ADDRESS,
} from "./addresses";

// Single live-state read used by Hero / Buy / Cranks.
export function useGetState() {
  return useReadContract({
    chainId: base.id,
    address: PENNYPOT_ADDRESS,
    abi: pennypotAbi,
    functionName: "getState",
    query: { refetchInterval: 15_000 },
  });
}

// Megapot drawing close + top prize tier (canonical "time to drawing close" —
// handles rollover edges where the active ticket belongs to a just-closed
// drawing). Also resolves the jackpot tier payout (index 11 = 5 normals +
// bonusball) via Megapot's PayoutCalculator, reading the calculator address
// from the drawing state itself so we follow any future rotation automatically.
export function useMegapotDrawingTime() {
  const id = useReadContract({
    chainId: base.id,
    address: JACKPOT_ADDRESS,
    abi: jackpotAbi,
    functionName: "currentDrawingId",
    query: { refetchInterval: 30_000 },
  });
  const state = useReadContract({
    chainId: base.id,
    address: JACKPOT_ADDRESS,
    abi: jackpotAbi,
    functionName: "getDrawingState",
    args: id.data !== undefined ? [id.data] : undefined,
    query: { enabled: id.data !== undefined, refetchInterval: 30_000 },
  });

  // Top tier payout = element [11] of the PayoutCalculator's 12-tier array.
  const drawingId = id.data;
  const prizePool = state.data?.prizePool;
  const ballMax = state.data?.ballMax;
  const bonusballMax = state.data?.bonusballMax;
  const payoutCalculator = state.data?.payoutCalculator as Address | undefined;
  const tiers = useReadContract({
    chainId: base.id,
    address: payoutCalculator,
    abi: payoutCalculatorAbi,
    functionName: "getExpectedDrawingTierPayouts",
    args:
      drawingId !== undefined &&
      prizePool !== undefined &&
      ballMax !== undefined &&
      bonusballMax !== undefined
        ? [drawingId, prizePool, ballMax, bonusballMax]
        : undefined,
    query: {
      enabled:
        !!payoutCalculator &&
        drawingId !== undefined &&
        prizePool !== undefined &&
        ballMax !== undefined &&
        bonusballMax !== undefined,
      refetchInterval: 30_000,
    },
  });

  return {
    drawingId: id.data,
    drawingTime: state.data?.drawingTime,
    prizePool,
    topPrize: tiers.data ? (tiers.data[11] as bigint) : undefined,
    raw: state.data,
  };
}

// User USDC balance + allowance for PennyPot (Buy section).
export function useUsdc(user?: Address) {
  return useReadContracts({
    contracts: [
      {
        chainId: base.id,
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [user ?? "0x0000000000000000000000000000000000000000"],
      },
      {
        chainId: base.id,
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [user ?? "0x0000000000000000000000000000000000000000", PENNYPOT_ADDRESS],
      },
    ],
    query: { enabled: Boolean(user), refetchInterval: 15_000 },
  });
}

// Per-user PennyPot claimable balance (Positions "withdraw" amount).
export function useClaimable(user?: Address) {
  return useReadContract({
    chainId: base.id,
    address: PENNYPOT_ADDRESS,
    abi: pennypotAbi,
    functionName: "balance",
    args: user ? [user] : undefined,
    query: { enabled: Boolean(user), refetchInterval: 15_000 },
  });
}

// Per-user claimable referral fees (Positions "Claim Fees" amount). Mirrors
// useClaimable but reads pendingFees, credited per round by the keeper's
// snapshotRoundFees → creditRoundFees cycle.
export function useFeesClaimable(user?: Address) {
  return useReadContract({
    chainId: base.id,
    address: PENNYPOT_ADDRESS,
    abi: pennypotAbi,
    functionName: "pendingFees",
    args: user ? [user] : undefined,
    query: { enabled: Boolean(user), refetchInterval: 15_000 },
  });
}

// User's per-ticket history — derived from SharesBought logs filtered by holder
// (the share owner; gifted positions surface for the recipient).
// (No on-chain "tickets I've ever bought into" enumeration; this is the canonical
// off-chain replay path.) Backed by react-query so it gets refreshed by the same
// queryClient.invalidateQueries() call that refreshes wagmi reads on tx success.
export type Position = {
  ticketId: bigint;
  shares: number; // sum of buyer's share count across all SharesBought events
  block: bigint; // block of the user's first share purchase — the purchase-order key
};

export function useUserPositions(user?: Address) {
  const publicClient = usePublicClient({ chainId: base.id });
  const q = useQuery({
    queryKey: ["userPositions", user, base.id, PENNYPOT_ADDRESS],
    enabled: !!user && !!publicClient,
    refetchInterval: 15_000,
    queryFn: async (): Promise<Position[]> => {
      if (!user || !publicClient) return [];
      const logs = await publicClient.getLogs({
        address: PENNYPOT_ADDRESS,
        event: {
          type: "event",
          name: "SharesBought",
          inputs: [
            { name: "ticketId", type: "uint256", indexed: true },
            { name: "holder", type: "address", indexed: true },
            { name: "payer", type: "address", indexed: false },
            { name: "count", type: "uint8", indexed: false },
            { name: "newSold", type: "uint8", indexed: false },
          ],
        },
        args: { holder: user },
        fromBlock: PENNYPOT_DEPLOY_BLOCK,
        toBlock: "latest",
      });
      // Megapot ticket IDs are random 256-bit values (NOT sequential), so they
      // can't order tickets by recency. Key purchase-order off the block of the
      // user's first share purchase on each ticket instead.
      const byTicket = new Map<bigint, { shares: number; block: bigint }>();
      for (const l of logs) {
        const tid = l.args.ticketId as bigint;
        const cnt = Number(l.args.count as number);
        const blk = l.blockNumber ?? 0n;
        const ex = byTicket.get(tid);
        if (ex) {
          ex.shares += cnt;
          if (blk < ex.block) ex.block = blk; // earliest purchase = the buy-in time
        } else {
          byTicket.set(tid, { shares: cnt, block: blk });
        }
      }
      return Array.from(byTicket.entries())
        .map(([ticketId, v]) => ({ ticketId, shares: v.shares, block: v.block }))
        .sort((a, b) => (a.block < b.block ? 1 : a.block > b.block ? -1 : 0)); // newest first
    },
  });
  return {
    positions: q.data,
    loading: q.isLoading,
    error: q.error ? (q.error as Error).message : undefined,
  };
}

// Per-ticket detail: (shares, holders, winningsPerShare, claimed).
export function useTicket(ticketId?: bigint) {
  return useReadContract({
    chainId: base.id,
    address: PENNYPOT_ADDRESS,
    abi: pennypotAbi,
    functionName: "getTicket",
    args: ticketId !== undefined ? [ticketId] : undefined,
    query: { enabled: ticketId !== undefined, refetchInterval: 15_000 },
  });
}

// Per-ticket cap table: holder addresses + their share counts (= % of the
// ticket, since a ticket is 100 shares). Drives the active ticket's HOLDERS list.
export function useTicketHolders(ticketId?: bigint) {
  return useReadContract({
    chainId: base.id,
    address: PENNYPOT_ADDRESS,
    abi: pennypotAbi,
    functionName: "getTicketHolders",
    args: ticketId !== undefined ? [ticketId] : undefined,
    query: {
      enabled: ticketId !== undefined && ticketId > 0n,
      refetchInterval: 15_000,
    },
  });
}

// All Megapot tickets bought by the PennyPot contract (newest first), fetched
// once from our server-side Data API proxy and shared across the app via a
// stable react-query key. The picks (lottery numbers) are NOT available from
// the PennyPot contract — they live in Megapot's TicketPurchased event — so the
// Data API is the right (and only) source for them. Fill/holder counts come
// from on-chain getTicket instead, since the Data API doesn't know PennyPot's
// share accounting.
export type TicketPicks = { normals: number[]; bonusball: number };

export type ContractTicket = {
  user_ticket_id: string;
  normals: number[];
  bonusball: number;
  round_id: string;
  tx_hash: string;
};

export function useMegapotContractTickets() {
  return useQuery({
    queryKey: ["megapotContractTickets", PENNYPOT_ADDRESS],
    refetchInterval: 60_000,
    queryFn: async (): Promise<ContractTicket[]> => {
      const res = await fetch("/api/megapot/tickets?limit=100");
      if (!res.ok) return [];
      const json = (await res.json()) as { data?: ContractTicket[] };
      return json.data ?? [];
    },
  });
}

// Lottery picks for a single ticket id, derived from the shared list above.
export function useTicketPicks(ticketId?: bigint) {
  const q = useMegapotContractTickets();
  const data = useMemo<TicketPicks | null>(() => {
    if (ticketId === undefined || ticketId === 0n || !q.data) return null;
    const m = q.data.find((t) => t.user_ticket_id === ticketId.toString());
    return m ? { normals: m.normals, bonusball: m.bonusball } : null;
  }, [ticketId, q.data]);
  return { data, isLoading: q.isLoading };
}

// Tickets in a drawing — used by the Cranks section to assemble claimWinnings args.
export function useDrawingTicketIds(drawingId?: bigint) {
  return useReadContract({
    chainId: base.id,
    address: PENNYPOT_ADDRESS,
    abi: pennypotAbi,
    functionName: "getDrawingTicketIds",
    args: drawingId !== undefined ? [drawingId] : undefined,
    query: { enabled: drawingId !== undefined, refetchInterval: 30_000 },
  });
}

// "Now" tick for countdowns. Re-renders every second.
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function useConnected(): Address | undefined {
  const { address } = useAccount();
  return address;
}

// Re-export some constants for component use.
export const CONSTS = {
  TICKET_PRICE_USDC: 1_000_000n, // 1 USDC = 1e6
  SHARE_PRICE_USDC: 10_000n, // 0.01 USDC = 1e4
  SHARES_PER_TICKET: 100,
  MIN_SELLING_WINDOW_SEC: 3600,
} as const;

// Memo-stable helpers.
export function useDerived() {
  return useMemo(
    () => ({
      sharePriceUsdc: CONSTS.SHARE_PRICE_USDC,
      ticketPriceUsdc: CONSTS.TICKET_PRICE_USDC,
      sharesPerTicket: CONSTS.SHARES_PER_TICKET,
    }),
    [],
  );
}
