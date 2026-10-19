"use client";

import { useQuery } from "@tanstack/react-query";

const GOLDSKY_URL =
  "https://api.goldsky.com/api/public/project_cmvckgzctt7nu01ztb3mpc7mo/subgraphs/pennypot/1.0.2/gn";

export async function fetchUserPositions(userAddress: string) {
  const query = `
    query GetUserPosition($id: ID!) {
      userPosition(id: $id) {
        totalTicketsBought
        totalShares
        totalClaimed
      }
    }
  `;

  try {
    const response = await fetch(GOLDSKY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { id: userAddress.toLowerCase() },
      }),
    });

    const { data } = await response.json();
    return data?.userPosition || null;
  } catch (error) {
    console.error("Goldsky error:", error);
    return null;
  }
}

export async function fetchUserTicketHistory(userAddress: string) {
  const query = `
    query GetUserTickets($user: String!) {
      ticketPurchases(
        where: { user: $user }
        orderBy: block
        orderDirection: desc
        first: 1000
      ) {
        ticketId
        shares
        block
      }
    }
  `;

  try {
    const response = await fetch(GOLDSKY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { user: userAddress.toLowerCase() },
      }),
    });

    const { data } = await response.json();
    return (data?.ticketPurchases ?? []) as Array<{
      ticketId: string;
      shares: number;
      block: string;
    }>;
  } catch (error) {
    console.error("Goldsky history error:", error);
    return [];
  }
}

export function useUserPositions(address?: string) {
  const query = useQuery({
    queryKey: ["goldskyUserPositions", address?.toLowerCase()],
    queryFn: async () => {
      if (!address) return [];
      const history = await fetchUserTicketHistory(address);
      return history.map((item) => ({
        ticketId: BigInt(item.ticketId),
        shares: Number(item.shares),
        block: BigInt(item.block),
      }));
    },
    enabled: !!address,
    refetchInterval: 15_000,
  });

  return {
    positions: query.data ?? [],
    loading: query.isLoading,
    error: query.isError ? "Failed to load positions." : null,
  };
}