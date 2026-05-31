"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
  useMegapotContractTickets,
  useUserPositions,
} from "@/lib/hooks";

const pad2 = (n: number) => String(n).padStart(2, "0");

// My Positions — a scannable portfolio (handoff §5): summary stats + Claim,
// Active/All filter tabs, and per-ticket rows that mirror the current-round
// ticket layout (balls · drawing date · share-of-ticket bar · Basescan link).
export function Positions() {
  const { address } = useAccount();
  const chainId = useChainId();
  const wrongChain = !!address && chainId !== base.id;
  const queryClient = useQueryClient();
  const claimable = useClaimable(address);
  const { positions, loading, error } = useUserPositions(address);

  // Per-ticket detail (shares, holders, winningsPerShare, claimed).
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

  // Each ticket's drawing id.
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

  // Drawing's ticket id list — for the friendly 1-based ticket number.
  const drawingTicketLists = useReadContracts({
    contracts: (positions ?? []).map((_p, i) => {
      const drawing = ticketDrawings.data?.[i]?.result as bigint | undefined;
      return {
        chainId: base.id,
        address: PENNYPOT_ADDRESS,
        abi: pennypotAbi,
        functionName: "getDrawingTicketIds" as const,
        args: [drawing ?? 0n] as const,
      };
    }),
    query: {
      enabled:
        !!positions &&
        positions.length > 0 &&
        !!ticketDrawings.data &&
        ticketDrawings.data.every((r) => r?.result !== undefined),
      refetchInterval: 60_000,
    },
  });

  // Each drawing's close time → the row's "DRAWING <date>" label.
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

  // Lottery picks per ticket (Data API), keyed by Megapot ticket id.
  const picksQ = useMegapotContractTickets();
  const picksMap = useMemo(() => {
    const m = new Map<string, { normals: number[]; bonusball: number }>();
    for (const t of picksQ.data ?? []) {
      m.set(t.user_ticket_id, { normals: t.normals, bonusball: t.bonusball });
    }
    return m;
  }, [picksQ.data]);

  // Combine + sort newest-drawing-first.
  const rows = (positions ?? [])
    .map((p, i) => {
      const det = ticketDetail.data?.[i]?.result as
        | readonly [number, number, bigint, boolean]
        | undefined;
      const drawing = ticketDrawings.data?.[i]?.result as bigint | undefined;
      const drawingIds = drawingTicketLists.data?.[i]?.result as
        | readonly bigint[]
        | undefined;
      const ds = drawingStates.data?.[i]?.result as
        | { drawingTime: bigint }
        | undefined;
      const idx = drawingIds?.findIndex((id) => id === p.ticketId);
      const ticketNumber = idx !== undefined && idx >= 0 ? idx + 1 : undefined;
      const claimed = det?.[3] ?? false;
      return {
        ticketId: p.ticketId,
        shares: p.shares,
        drawing,
        drawingTime: ds?.drawingTime,
        ticketNumber,
        active: !claimed,
        picks: picksMap.get(p.ticketId.toString()),
      };
    })
    .sort((a, b) => {
      const da = a.drawing ?? 0n;
      const db = b.drawing ?? 0n;
      return da === db ? 0 : db > da ? 1 : -1;
    });

  const activeRows = rows.filter((r) => r.active);
  const ticketsCount = rows.length;
  const activeShares = activeRows.reduce((s, r) => s + r.shares, 0);
  const claimableAmt = claimable.data ?? 0n;
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

  async function doClaim() {
    if (!publicClient || !address) return;
    const amount = claimableAmt;
    setWithdrawing(true);
    const toastId = toast.loading(
      `Claiming ${formatUsdc(amount)}… (confirm in wallet)`,
    );
    try {
      const hash = await writeContractAsync({
        address: PENNYPOT_ADDRESS,
        abi: pennypotAbi,
        functionName: "withdraw",
      });
      toast.loading(`Waiting for claim to confirm on-chain…`, { id: toastId });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Anchor the post-tx read to the receipt's block so RPC node lag can't
      // serve stale data — poll up to ~6s until we observe the cleared balance.
      for (let i = 0; i < 12; i++) {
        try {
          const newBalance = (await publicClient.readContract({
            address: PENNYPOT_ADDRESS,
            abi: pennypotAbi,
            functionName: "balance",
            args: [address],
            blockNumber: receipt.blockNumber,
          })) as bigint;
          if (newBalance < amount) break;
        } catch {
          // RPC behind on this block — wait and retry.
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      queryClient.invalidateQueries();
      toast.success(`Claimed ${formatUsdc(amount)}`, {
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
            {/* summary: stats + Claim, one inline row */}
            <div className="flex flex-wrap items-center gap-5">
              <Stat k="Tickets" v={ticketsCount.toString()} />
              <Stat k="Active shares" v={activeShares.toString()} />
              <Stat
                k="Claimable"
                v={formatUsdc(claimableAmt)}
                tone={hasClaimable ? "mint" : "dim"}
              />
              <button
                type="button"
                onClick={doClaim}
                disabled={!hasClaimable || withdrawing || wrongChain}
                className={`ml-auto rounded-[9px] border border-ink-500 px-6 py-[11px] font-mono text-[13px] font-bold transition disabled:cursor-not-allowed ${
                  hasClaimable
                    ? "bg-accent text-[#10000a] hover:shadow-[0_4px_16px_rgba(255,45,136,0.35)]"
                    : "bg-transparent text-ink-300"
                }`}
              >
                {withdrawing ? "claiming…" : "Claim"}
              </button>
            </div>

            <div className="my-5 h-px bg-ink-500" />

            {/* filter tabs */}
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

            {/* rows */}
            {loading ? (
              <div className="mt-3 text-sm text-ink-300">loading from logs…</div>
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
    <div className="flex items-center gap-4 border-b border-ink-500 py-4 last:border-b-0">
      <PositionBalls picks={r.picks} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-300">
          Drawing {dateLabel}
        </span>
      </div>
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
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent font-mono text-[10px] font-bold tabular-nums text-[#10000a] shadow-[0_0_10px_rgba(255,45,136,0.45)]">
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
