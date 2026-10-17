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

export function useMegapotContractTickets(ticketIds?: bigint[]) {
  const { data: gs } = useGetState();
  const drawingId = gs?.[0];
  const drawingTickets = useDrawingTicketIds(drawingId);

  const idsToFetch = useMemo(() => {
    const set = new Set<string>();
    if (ticketIds) ticketIds.forEach(id => set.add(id.toString()));
    if (drawingTickets.data) drawingTickets.data.forEach(id => set.add(id.toString()));
    return Array.from(set).map(id => BigInt(id));
  }, [ticketIds, drawingTickets.data]);

  return useQuery({
    // Спрощений ключ для кешу, щоб не ламався React Query
    queryKey: ["megapotTickets", idsToFetch.length, drawingId?.toString()],
    queryFn: async () => {
      if (idsToFetch.length === 0) return [];
      
      const chunkSize = 15;
      const allTickets: { user_ticket_id: string; normals: number[]; bonusball: number; }[] = [];
      
      for (let i = 0; i < idsToFetch.length; i += chunkSize) {
        const chunk = idsToFetch.slice(i, i + chunkSize);
        const idsString = chunk.map((id) => id.toString()).join(",");
        
        try {
          const res = await fetch(`/api/megapot/tickets?ids=${idsString}`);
          if (res.ok) {
            const json = await res.json();
            const arr = json.tickets || (Array.isArray(json) ? json : []);
            
            for (const t of arr) {
              allTickets.push({
                user_ticket_id: String(t.user_ticket_id), // Жорстко переводимо в рядок!
                normals: t.normals,
                bonusball: t.bonusball
              });
            }
          }
        } catch (e) {
          console.error("Failed to fetch chunk of tickets", e);
        }
      }
      return allTickets;
    },
    enabled: idsToFetch.length > 0,
    refetchInterval: 60_000,
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