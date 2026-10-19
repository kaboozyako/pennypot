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
  USDC_ADDRESS,
} from "./addresses";
import { fetchUserTicketHistory } from "./goldsky"; 

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
export const CONSTS = {
  TICKET_PRICE_USDC: 1_000_000n,
  SHARE_PRICE_USDC: 10_000n,
  SHARES_PER_TICKET: 100,
  MIN_SELLING_WINDOW_SEC: 3600,
} as const;

// -----------------------------------------------------------------------------
// Standard Wagmi hooks for Megapot/PennyPot state
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
  
  const query = useReadContract({
    chainId: base.id,
    address: JACKPOT_ADDRESS,
    abi: jackpotAbi,
    functionName: "getDrawingState",
    args: currentDrawingId !== undefined ? [currentDrawingId] : undefined,
    query: {
      enabled: currentDrawingId !== undefined,
      refetchInterval: 10_000,
    },
  });

  return {
    ...query,
    drawingTime: query.data ? Number(query.data.drawingTime) : undefined,
    topPrize: query.data ? query.data.prizePool : undefined,
  };
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
        args: [
          user ?? "0x0000000000000000000000000000000000000000",
          PENNYPOT_ADDRESS,
        ],
      },
    ],
    query: {
      refetchInterval: 5_000,
    },
  });
}

export function useTicketHolders(ticketId?: bigint) {
  return useReadContract({
    chainId: base.id,
    address: PENNYPOT_ADDRESS,
    abi: pennypotAbi,
    functionName: "getTicketHolders",
    args: ticketId !== undefined ? [ticketId] : undefined,
  });
}

export function useDrawingTicketIds(drawingId?: bigint) {
  return useReadContract({
    chainId: base.id,
    address: PENNYPOT_ADDRESS,
    abi: pennypotAbi,
    functionName: "getDrawingTicketIds",
    args: drawingId !== undefined ? [drawingId] : undefined,
    query: { enabled: drawingId !== undefined, refetchInterval: 10_000 },
  });
}

// Повертаємо оригінальний хук тільки для активного раунду (щоб він працював миттєво)
export function useMegapotContractTickets() {
  const { data: gs } = useGetState();
  const drawingId = gs?.[0];
  const drawingTickets = useDrawingTicketIds(drawingId);

  return useQuery({
    queryKey: ["megapotTickets", drawingId?.toString(), drawingTickets.data?.length],
    queryFn: async () => {
      if (!drawingTickets.data || drawingTickets.data.length === 0) return [];
      const ids = drawingTickets.data.map((id) => id.toString());
      const res = await fetch(`/api/megapot/tickets?ids=${ids.join(",")}`);
      if (!res.ok) throw new Error("Failed to fetch tickets");
      const json = await res.json();
      return (json.tickets ?? []) as { user_ticket_id: string; normals: number[]; bonusball: number; }[];
    },
    enabled: !!drawingTickets.data && drawingTickets.data.length > 0,
    refetchInterval: 15_000,
  });
}

// НОВИЙ фоновий хук для завантаження номерів історії позицій
export function useHistoryTicketPicks(ticketIds: bigint[]) {
  return useQuery({
    queryKey: ["historyPicks", ticketIds.length],
    queryFn: async () => {
      if (!ticketIds || ticketIds.length === 0) return [];
      
      const chunkSize = 15;
      const allTickets: { user_ticket_id: string; normals: number[]; bonusball: number; }[] = [];
      
      for (let i = 0; i < ticketIds.length; i += chunkSize) {
        const chunk = ticketIds.slice(i, i + chunkSize);
        try {
          const res = await fetch(`/api/megapot/tickets?ids=${chunk.join(",")}`);
          if (res.ok) {
            const json = await res.json();
            const arr = json.tickets ? json.tickets : (Array.isArray(json) ? json : []);
            for (const t of arr) {
              allTickets.push({
                user_ticket_id: String(t.user_ticket_id || t.id || ""),
                normals: t.normals || [],
                bonusball: t.bonusball || 0
              });
            }
          }
        } catch (e) {
          console.error("Megapot chunk fetch error:", e);
        }
        // Пауза, щоб Megapot не заблокував нас за спам запитами
        if (i + chunkSize < ticketIds.length) {
          await new Promise(r => setTimeout(r, 200));
        }
      }
      return allTickets;
    },
    enabled: ticketIds.length > 0,
    staleTime: Infinity, // Номери в історії ніколи не змінюються, кешуємо назавжди
  });
}

export function useTicketPicks(ticketId?: bigint) {
  const q = useMegapotContractTickets();
  const data = useMemo(() => {
    if (ticketId === undefined || !q.data) return undefined;
    return q.data.find((t) => String(t.user_ticket_id) === ticketId.toString());
  }, [ticketId, q.data]);

  return { data };
}

export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// -----------------------------------------------------------------------------
// === Історія позицій переведена на React Query для оптимізації ===
// -----------------------------------------------------------------------------

export function useUserPositions(address?: string) {
  const query = useQuery({
    queryKey: ["userPositions", address],
    queryFn: async () => {
      if (!address) return [];
      const history = await fetchUserTicketHistory(address);
      return history.map((item: any) => ({
        ticketId: BigInt(item.ticketId),
        shares: Number(item.shares),
        block: BigInt(item.block)
      }));
    },
    enabled: !!address,
    refetchInterval: 30000,
  });

  return { 
    positions: query.data ?? [], 
    loading: query.isLoading, 
    error: query.isError ? "Failed to load positions." : null 
  };
}