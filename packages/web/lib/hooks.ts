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
import {
  erc20Abi,
  jackpotAbi,
  payoutCalculatorAbi,
  pennypotAbi,
} from "./abis";
import {
  JACKPOT_ADDRESS,
  PENNYPOT_ADDRESS,
  PENNYPOT_DEPLOY_BLOCK,
  USDC_ADDRESS,
} from "./addresses";
import { fetchUserTicketHistory } from "./goldsky"; // імпортуємо новий фетчер

// -----------------------------------------------------------------------------
// Existing standard Wagmi hooks for Megapot/PennyPot state
// -----------------------------------------------------------------------------

export function useGetState() {
  return useReadContract({
    chainId: base.id,
    address: PENNYPOT_ADDRESS,
    abi: pennypotAbi,
    functionName: "getState",
    query: { refetchInterval: 10_000 },
  });
}

export function useMegapotDrawingTime() {
  const { data: gs } = useGetState();
  const currentDrawingId = gs?.[0];
  return useReadContract({
    chainId: base.id,
    address: JACKPOT_ADDRESS,
    abi: jackpotAbi,
    functionName: "getDrawingState",
    args: currentDrawingId !== undefined ? [currentDrawingId] : undefined,
    query: {
      enabled: currentDrawingId !== undefined,
      refetchInterval: 10_000,
    },
    select: (s) => Number(s.drawingTime),
  });
}

export function useClaimable(user?: Address) {
  return useReadContract({
    chainId: base.id,
    address: PENNYPOT_ADDRESS,
    abi: pennypotAbi,
    functionName: "balance",
    args: user ? [user] : undefined,
    query: { enabled: !!user, refetchInterval: 15_000 },
  });
}

export function useFeesClaimable(user?: Address) {
  return useReadContract({
    chainId: base.id,
    address: PENNYPOT_ADDRESS,
    abi: pennypotAbi,
    functionName: "pendingFees",
    args: user ? [user] : undefined,
    query: { enabled: !!user, refetchInterval: 15_000 },
  });
}

export function useUsdcAllowance(user?: Address) {
  return useReadContract({
    chainId: base.id,
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: user ? [user, PENNYPOT_ADDRESS] : undefined,
    query: { enabled: !!user, refetchInterval: 5_000 },
  });
}

export function useUsdcBalance(user?: Address) {
  return useReadContract({
    chainId: base.id,
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: user ? [user] : undefined,
    query: { enabled: !!user, refetchInterval: 5_000 },
  });
}

export type TicketData = {
  user_ticket_id: string;
  normals: number[];
  bonusball: number;
};

export function useMegapotContractTickets() {
  const { data: gs } = useGetState();
  const drawingId = gs?.[0];

  const drawingTickets = useReadContract({
    chainId: base.id,
    address: PENNYPOT_ADDRESS,
    abi: pennypotAbi,
    functionName: "getDrawingTicketIds",
    args: drawingId !== undefined ? [drawingId] : undefined,
    query: { enabled: drawingId !== undefined, refetchInterval: 10_000 },
  });

  return useQuery({
    queryKey: ["megapotTickets", drawingId?.toString(), drawingTickets.data?.length],
    queryFn: async () => {
      if (!drawingTickets.data || drawingTickets.data.length === 0) return [];
      const ids = drawingTickets.data.map((id) => id.toString());
      const res = await fetch(`/api/megapot/tickets?ids=${ids.join(",")}`);
      if (!res.ok) throw new Error("Failed to fetch tickets");
      const json = await res.json();
      return (json.tickets ?? []) as TicketData[];
    },
    enabled: !!drawingTickets.data && drawingTickets.data.length > 0,
    refetchInterval: 15_000,
  });
}

// -----------------------------------------------------------------------------
// === НОВИЙ ШВИДКИЙ ХУК: Отримує історію квитків з Goldsky ===
// -----------------------------------------------------------------------------

export function useUserPositions(address?: string) {
  const [positions, setPositions] = useState<{ ticketId: bigint; shares: number; block: bigint }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadTickets() {
      if (!address) {
        setPositions([]);
        return;
      }
      
      setLoading(true);
      setError(null);
      
      try {
        const history = await fetchUserTicketHistory(address);
        
        const formatted = history.map((item: any) => ({
          ticketId: BigInt(item.ticketId),
          shares: Number(item.shares),
          block: BigInt(item.block)
        }));
        
        setPositions(formatted);
      } catch (err) {
        console.error(err);
        setError("Failed to load positions.");
      } finally {
        setLoading(false);
      }
    }
    
    loadTickets();
  }, [address]);

  return { positions, loading, error };
}