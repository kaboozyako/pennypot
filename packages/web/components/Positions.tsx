"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { toast } from "sonner";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContracts,
  useWriteContract,
} from "wagmi";
import { base } from "wagmi/chains";
import { jackpotAbi, pennypotAbi } from "@/lib/abis";
import {
  JACKPOT_ADDRESS,
  JACKPOT_TICKET_NFT_ADDRESS,
  PENNYPOT_ADDRESS,
} from "@/lib/addresses";
import { formatUsdc } from "@/lib/format";
import {
  useClaimable,
  useFeesClaimable,
  useGetState,
  useMegapotContractTickets,
  useUserPositions,
} from "@/lib/hooks";
import { fetchUserPositions } from "@/lib/goldsky";

const pad2 = (n: number) => String(n).padStart(2, "0");

export function Positions() {
  const { address } = useAccount();
  const chainId = useChainId();
  const wrongChain = !!address && chainId !== base.id;
  const queryClient = useQueryClient();
  const claimable = useClaimable(address);
  const feesClaimable = useFeesClaimable(address);
  const { data: gs } = useGetState();
  const currentDrawingId = gs?.[0];
  
  const { positions, loading, error } = useUserPositions(address);

  const [fastStats, setFastStats] = useState({
    tickets: "0",
    shares: "0",
    totalClaimedRaw: "0",
    loading: true,
  });

  useEffect(() => {
    async function loadFastStats() {
      if (!address) return;
      setFastStats((prev) => ({ ...prev, loading: true }));
      const data = await fetchUserPositions(address);
      if (data) {
        setFastStats({
          tickets: String(data.totalTicketsBought),
          shares: String(data.totalShares),
          totalClaimedRaw: String(data.totalClaimed || "0"),
          loading: false,
        });
      } else {
        setFastStats((prev) => ({ ...prev, loading: false }));
      }
    }
    loadFastStats();
  }, [address]);

  const ticketDrawings = useReadContracts({
    contracts: (positions ?? []).map((p) => ({
      chainId: base.id,
      address: PENNYPOT_ADDRESS,
      abi: pennypotAbi,
      functionName: "ticketDrawingId" as const,
      args: [p.ticketId] as const,
    })),
    query: { enabled: !!positions && positions.length > 0, refetchInterval: 60_000 },
  });

  const ticketDetail = useReadContracts({
    contracts: (positions ?? []).map((p) => ({
      chainId: base.id,
      address: PENNYPOT_ADDRESS,
      abi: pennypotAbi,
      functionName: "getTicket" as const,
      args: [p.ticketId] as const,
    })),
    query: { enabled: !!positions && positions.length > 0, refetchInterval: 30_000 },
  });

  const drawingStates = useReadContracts({
    contracts: (positions ?? []).map((_p, i) => {
      const drawing = ticketDrawings.data?.[i]?.result as bigint | undefined;
      return {
        chainId: base.id,
        address: JACKPOT_ADDRESS,
        abi: jackpotAbi,
        functionName: "getDrawingState" as const,
        args: [drawing ?? 0n] as const,
      };
    }),
    query: {
      enabled:
        !!positions &&
        positions.length > 0 &&
        !!ticketDrawings.data &&
        ticketDrawings.data.every((r) => r?.result !== undefined),
      refetchInterval: 300_000,
    },
  });

  // Вызываем без аргументов — хук сам подтянет историю и объединит кэш
  const picksQ = useMegapotContractTickets();
  
  const picksMap = useMemo(() => {
    const m = new Map<string, { normals: number[]; bonusball: number }>();
    for (const t of picksQ.data ?? []) {
      m.set(String(t.user_ticket_id), { normals: t.normals, bonusball: t.bonusball });
    }
    return m;
  }, [picksQ.data]);

  const rows = (positions ?? [])
    .map((p, i) => {
      const drawing = ticketDrawings.data?.[i]?.result as bigint | undefined;
      const ds = drawingStates.data?.[i]?.result as
        | { drawingTime: bigint }
        | undefined;
      const det = ticketDetail.data?.[i]?.result as
        | readonly [number, number, bigint, boolean]
        | undefined;
      const active =
        drawing !== undefined &&
        currentDrawingId !== undefined &&
        drawing === currentDrawingId;
      const wps = det?.[2] ?? 0n;
      const won = wps > 0n ? wps * BigInt(p.shares) : 0n;
      return {
        ticketId: p.ticketId,
        shares: p.shares,
        block: p.block,
        drawing,
        drawingTime: ds?.drawingTime,
        active,
        won,
        picks: picksMap.get(p.ticketId.toString()),
      };
    })
    .sort((a, b) => {
      const da = a.drawing ?? 0n;
      const db = b.drawing ?? 0n;
      if (da !== db) return db > da ? 1 : -1;
      return b.block > a.block ? 1 : a.block > b.block ? -1 : 0;
    });

  const activeRows = rows.filter((r) => r.active);
  
  const displayTickets = fastStats.loading ? "..." : fastStats.tickets;
  const displayShares = fastStats.loading ? "..." : fastStats.shares;
  const displayTotalWinnings = fastStats.loading ? "..." : formatUsdc(BigInt(fastStats.totalClaimedRaw));

  const winningsAmt = claimable.data ?? 0n;
  const feesAmt = feesClaimable.data ?? 0n;
  const claimableAmt = winningsAmt + feesAmt;
  const hasClaimable = claimableAmt > 0n;

  const [filter, setFilter] = useState<"Active" | "All">("Active");
  const shown = filter === "All" ? rows : activeRows;
  const tabs: Array<["Active" | "All", number]> = [
    ["Active", activeRows.length],
    ["All", rows.length],
  ];

  const publicClient = usePublicClient({ chainId: base.id });
  const { writeContractAsync } = useWriteContract();
  const [withdrawing, setWithdrawing] = useState(false);

  async function withdrawAndConfirm(
    fn: "withdraw" | "withdrawFees",
    readFn: "balance" | "pendingFees",
    amount: bigint,
    toastId: string | number,
  ) {
    if (!publicClient || !address) return;
    const hash = await writeContractAsync({
      address: PENNYPOT_ADDRESS,
      abi: pennypotAbi,
      functionName: fn,
    });
    toast.loading(`Waiting for claim to confirm on-chain…`, { id: toastId });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    for (let i = 0; i < 12; i++) {
      try {
        const newBalance = (await publicClient.readContract({
          address: PENNYPOT_ADDRESS,
          abi: pennypotAbi,
          functionName: readFn,
          args: [address],
          blockNumber: receipt.blockNumber,
        })) as bigint;
        if (newBalance < amount) break;
      } catch {
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async function doClaim() {
    if (!publicClient || !address) return;
    const total = claimableAmt;
    if (total === 0n) return;
    setWithdrawing(true);
    const toastId = toast.loading(
      `Claiming ${formatUsdc(total)}… (confirm in wallet)`,
    );
    try {
      if (winningsAmt > 0n) {
        await withdrawAndConfirm("withdraw", "balance", winningsAmt, toastId);
      }
      if (feesAmt > 0n) {
        await withdrawAndConfirm("withdrawFees", "pendingFees", feesAmt, toastId);
      }

      queryClient.invalidateQueries();
      toast.success(`Claimed ${formatUsdc(total)}`, {
        id: toastId,
        description: `Sent to your wallet on Base.`,
        duration: 6000,
      });
    } catch (e) {
      const msg = (e as Error).message.split("\n")[0];
      const userRejected = /reject|denied|user/i.test(msg);
      toast.error(userRejected ? "Wallet rejected the request" : "Claim failed", {
        id: toastId,
        description: userRejected ? undefined : msg.slice(0, 180),
      });
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <section className="relative z-10 mx-auto w-full max-w-3xl px-4 py-6">
      <h2 className="mb-3 px-1 font-mono text-xs uppercase tracking-[0.25em] text-ink-300">
        ▌ My positions
      </h2>

      <div className="rounded-2xl border border-ink-500 bg-ink-700 p-6">
        {!address ? (
          <p className="text-ink-200">Connect a wallet to see your positions.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-5">
              <Stat k="Total tickets" v={displayTickets} />
              <Stat k="Total shares" v={displayShares} />
              <Stat k="Total winnings" v={displayTotalWinnings} tone="mint" />
              <Stat
                k="Claimable"
                v={formatUsdc(claimableAmt)}
                tone={hasClaimable ? "mint" : "dim"}
              />
              {hasClaimable ? (
                <button
                  type="button"
                  onClick={doClaim}
                  disabled={withdrawing || wrongChain}
                  className="ml-auto rounded-[9px] border border-ink-500 bg-accent px-6 py-[11px] font-mono text-[13px] font-bold text-[#10000a] transition hover:shadow-[0_4px_16px_rgba(255,191,0,0.35)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {withdrawing
                    ? "claiming…"
                    : wrongChain
                      ? "switch to Base"
                      : "Claim"}
                </button>
              ) : null}
            </div>

            <div className="my-5 h-px bg-ink-500" />

            <div className="flex gap-1.5 pb-1">
              {tabs.map(([t, n]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFilter(t)}
                  className={`rounded-lg px-3 py-[7px] font-mono text-[12.5px] font-semibold transition ${
                    filter === t
                      ? "bg-ink-600 text-ink-100 shadow-[inset_0_0_0_1px_#262626]"
                      : "bg-transparent text-ink-300 hover:text-ink-200"
                  }`}
                >
                  {t} <span className="ml-0.5 text-ink-300">{n}</span>
                </button>
              ))}
            </div>

            {loading ? (
              <div className="mt-3 text-sm text-ink-300">syncing...</div>
            ) : error ? (
              <div className="mt-3 text-xs text-accent">{error}</div>
            ) : rows.length === 0 ? (
              <div className="mt-3 text-sm text-ink-300">
                No share purchases yet.
              </div>
            ) : shown.length === 0 ? (
              <div className="mt-3 text-sm text-ink-300">
                No {filter.toLowerCase()} positions.
              </div>
            ) : (
              <div className="mt-1">
                {shown.map((r) => (
                  <PositionRow key={r.ticketId.toString()} r={r} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

type Row = {
  ticketId: bigint;
  shares: number;
  drawingTime?: bigint;
  active: boolean;
  won: bigint;
  picks?: { normals: number[]; bonusball: number };
};

function PositionRow({ r }: { r: Row }) {
  const dateLabel =
    r.drawingTime !== undefined
      ? new Date(Number(r.drawingTime) * 1000)
          .toLocaleDateString("en-US", { month: "long", day: "numeric" })
          .toUpperCase()
      : "—";
  return (
    <div className="flex flex-col gap-3 border-b border-ink-500 py-4 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 sm:flex-1">
        <PositionBalls picks={r.picks} />
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-300">
          {dateLabel}
        </span>
        {r.won > 0n ? (
          <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-accent">
            won {formatUsdc(r.won, { dp: 2 })}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex w-[150px] shrink-0 flex-col items-end gap-1.5">
          <div className="h-[5px] w-full overflow-hidden rounded-[3px] bg-[#1d1d21]">
            <div
              className={`h-full rounded-[3px] ${r.active ? "bg-accent" : "bg-ink-300"}`}
              style={{ width: `${Math.min(100, r.shares)}%` }}
            />
          </div>
          <span
            className={`font-mono text-[11.5px] font-bold tabular-nums ${
              r.active ? "text-ink-100" : "text-ink-300"
            }`}
          >
            {r.shares} shares
          </span>
        </div>
        <a
          href={`https://basescan.org/nft/${JACKPOT_TICKET_NFT_ADDRESS}/${r.ticketId}`}
          target="_blank"
          rel="noopener noreferrer"
          title="View on Basescan"
          className="flex shrink-0 items-center text-ink-300 transition hover:text-accent"
        >
          <ExtIcon />
        </a>
      </div>
    </div>
  );
}

function PositionBalls({
  picks,
}: {
  picks?: { normals: number[]; bonusball: number };
}) {
  if (!picks) {
    return (
      <div className="flex shrink-0 items-center gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            className="h-6 w-6 rounded-full border-[1.5px] border-white/10"
          />
        ))}
        <span className="h-6 w-6 rounded-full bg-ink-600" />
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {picks.normals.map((n, i) => (
        <span
          key={`${i}-${n}`}
          className="flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] border-white/20 font-mono text-[10px] font-bold tabular-nums text-[#e6e6e8]"
        >
          {pad2(n)}
        </span>
      ))}
      <span className="h-0.5 w-[5px] rounded-sm bg-ink-300" />
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent font-mono text-[10px] font-bold tabular-nums text-[#10000a] shadow-[0_0_10px_rgba(255,191,0,0.45)]">
        {pad2(picks.bonusball)}
      </span>
    </div>
  );
}

function Stat({
  k,
  v,
  tone,
}: {
  k: string;
  v: string;
  tone?: "ink" | "mint" | "dim";
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-300">
        {k}
      </div>
      <span
        className={`font-mono text-[21px] font-bold tabular-nums ${
          tone === "mint"
            ? "text-[#37d9a4]"
            : tone === "dim"
              ? "text-ink-300"
              : "text-ink-100"
        }`}
      >
        {v}
      </span>
    </div>
  );
}

function ExtIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 7L7 3M4 3h3v3" />
    </svg>
  );
}