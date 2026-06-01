"use client";

import NumberFlow from "@number-flow/react";
import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { base } from "wagmi/chains";
import { pennypotAbi } from "@/lib/abis";
import { PENNYPOT_ADDRESS } from "@/lib/addresses";
import {
  useDrawingTicketIds,
  useGetState,
  useMegapotContractTickets,
  useMegapotDrawingTime,
  useNow,
} from "@/lib/hooks";

// Tickets PennyPot has bought in the current Megapot round. Hybrid data:
//  - on-chain getDrawingTicketIds + getTicket  → authoritative list + fill/holders
//  - Data API (via useMegapotContractTickets)  → lottery picks (not on-chain)
export function CurrentRound() {
  const { data: state } = useGetState();
  const drawingId = state?.[0];
  const activeTicketId = state?.[1];

  const idsQ = useDrawingTicketIds(drawingId);
  const ticketIds = (idsQ.data ?? []) as readonly bigint[];

  const details = useReadContracts({
    contracts: ticketIds.map((id) => ({
      chainId: base.id,
      address: PENNYPOT_ADDRESS,
      abi: pennypotAbi,
      functionName: "getTicket" as const,
      args: [id] as const,
    })),
    query: { enabled: ticketIds.length > 0, refetchInterval: 15_000 },
  });

  const picksQ = useMegapotContractTickets();
  const picksMap = useMemo(() => {
    const m = new Map<string, { normals: number[]; bonusball: number }>();
    for (const t of picksQ.data ?? []) {
      m.set(t.user_ticket_id, { normals: t.normals, bonusball: t.bonusball });
    }
    return m;
  }, [picksQ.data]);

  // Newest first; ticket number is the 1-based purchase index within the round.
  const rows = ticketIds
    .map((id, i) => {
      const det = details.data?.[i]?.result as
        | readonly [number, number, bigint, boolean]
        | undefined;
      return {
        id,
        sold: det?.[0] ?? 0,
        holders: det?.[1] ?? 0,
        picks: picksMap.get(id.toString()),
        isActive: activeTicketId !== undefined && id === activeTicketId,
      };
    })
    .reverse();

  return (
    <section className="relative z-10 mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-ink-300">
          ▌ Live tickets
        </h2>
        <DrawingCountdown />
      </div>

      <div className="rounded-2xl border border-ink-500 bg-ink-700/60 p-2 sm:p-3">
        {idsQ.isLoading ? (
          <div className="p-6 text-center text-sm text-ink-300">loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-ink-300">
            No tickets in this round yet.
          </div>
        ) : (
          <ul className="divide-y divide-ink-500/60">
            {rows.map((r) => (
              <li
                key={r.id.toString()}
                className="flex flex-col items-start gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {r.picks ? (
                    <Picks
                      normals={r.picks.normals}
                      bonusball={r.picks.bonusball}
                    />
                  ) : (
                    <div className="font-mono text-[11px] text-ink-300">
                      picks loading…
                    </div>
                  )}
                  {r.isActive ? (
                    <span className="shrink-0 rounded bg-[#16f08a]/15 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-[#16f08a]">
                      now selling
                    </span>
                  ) : null}
                </div>
                <div className="shrink-0 font-mono text-sm sm:text-right">
                  <div className="flex items-center gap-2 sm:justify-end">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-600">
                      <div
                        className="h-full bg-accent transition-[width] duration-500 ease-out"
                        style={{ width: `${r.sold}%` }}
                      />
                    </div>
                    <span className="w-9 text-right text-[11px] text-ink-200">
                      {r.sold}%
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-ink-300">
                    {r.holders} holder{r.holders === 1 ? "" : "s"}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Picks({
  normals,
  bonusball,
}: {
  normals: number[];
  bonusball: number;
}) {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {normals.map((n, i) => (
        <span
          key={`${i}-${n}`}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-ink-500 bg-ink-800/70 font-mono text-xs font-bold text-ink-100"
        >
          {pad(n)}
        </span>
      ))}
      <span
        className="flex h-7 w-7 items-center justify-center rounded-full bg-accent font-mono text-xs font-bold text-ink-900 shadow-glow"
        title="Bonusball"
      >
        {pad(bonusball)}
      </span>
    </div>
  );
}

// "Drawing in HH:MM:SS" — time until the current Megapot round closes, with each
// digit segment animated via @number-flow/react.
function DrawingCountdown() {
  const { drawingTime } = useMegapotDrawingTime();
  const now = useNow();
  if (drawingTime === undefined) return null;

  const diff = Math.max(0, Number(drawingTime) - Math.floor(now / 1000));
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  const fmt = { minimumIntegerDigits: 2 } as const;

  return (
    <div className="flex shrink-0 items-center gap-1.5 font-mono text-xs uppercase tracking-widest">
      <span className="text-ink-300">Drawing in</span>
      <span className="flex items-center tabular-nums text-accent">
        <NumberFlow value={h} format={fmt} />
        <span className="px-0.5">:</span>
        <NumberFlow value={m} format={fmt} />
        <span className="px-0.5">:</span>
        <NumberFlow value={s} format={fmt} />
      </span>
    </div>
  );
}
