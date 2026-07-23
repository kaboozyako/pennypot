"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ConnectKitButton } from "connectkit";
import Link from "next/link";
import { PENNYPOT_ADDRESS } from "@/lib/addresses";
import { formatUsdc, shortAddr } from "@/lib/format";

// Schema matches https://api.megapot.io/v1/wallets/{addr}/tickets — see the
// megapot skill / api.megapot.io/v1/docs for the canonical shape.
type Ticket = {
  id: string;
  wallet: string;
  buyer: string;
  round_id: string;
  user_ticket_id: string;
  normals: number[];
  bonusball: number;
  matched_normals: number | null;
  bonusball_match: boolean | null;
  winnings_amount: { amount: string; decimals: number } | null;
  claimed: boolean;
  claimed_tx_hash: string | null;
  tx_hash: string;
  block_number: number;
  created_at: string;
};

type Page = {
  data: Ticket[];
  next_cursor: string | null;
  has_more: boolean;
};

const PAGE_SIZE = 25;

async function fetchPage({
  pageParam,
}: {
  pageParam: string | undefined;
}): Promise<Page> {
  const url = new URL("/api/megapot/tickets", window.location.origin);
  url.searchParams.set("limit", String(PAGE_SIZE));
  if (pageParam) url.searchParams.set("cursor", pageParam);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Megapot API ${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<Page>;
}

export default function TicketsPage() {
  const q = useInfiniteQuery({
    queryKey: ["megapot-tickets", PENNYPOT_ADDRESS],
    queryFn: fetchPage,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    refetchInterval: 60_000,
  });

  const tickets = q.data?.pages.flatMap((p) => p.data) ?? [];
  const total = tickets.length;

  return (
    <main className="relative z-10">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 pt-4">
        <Link
          href="/"
          aria-label="PennyPot — home"
          className="flex items-center font-mono text-4xl font-black leading-none tracking-tighter sm:text-5xl"
        >
          <span className="text-accent drop-shadow-[0_0_14px_rgba(255,45,136,0.6)]">
            PENNY
          </span>
          <span className="text-ink-100">POT</span>
        </Link>
        <ConnectKitButton showBalance={false} />
      </header>

      <section className="relative z-10 mx-auto w-full max-w-3xl px-4 py-12">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="font-mono text-2xl font-black tracking-tighter sm:text-3xl">
              Megapot tickets bought by PennyPot
            </h1>
            <p className="mt-1 text-xs text-ink-300 sm:text-sm">
              Live from{" "}
              <code className="font-mono text-ink-200">api.megapot.io</code> ·
              recipient{" "}
              <a
                href={`https://basescan.org/address/${PENNYPOT_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-ink-200 hover:text-accent"
              >
                {shortAddr(PENNYPOT_ADDRESS)}
              </a>
            </p>
          </div>
          <Link
            href="/"
            className="shrink-0 font-mono text-[11px] uppercase tracking-widest text-ink-300 hover:text-accent"
          >
            ← back
          </Link>
        </div>

        <div className="rounded-2xl border border-ink-500 bg-ink-700/60 p-2 sm:p-3">
          {q.isLoading ? (
            <div className="p-6 text-center text-sm text-ink-300">
              loading tickets…
            </div>
          ) : q.isError ? (
            <div className="p-6 text-center text-sm text-accent">
              {(q.error as Error).message}
            </div>
          ) : tickets.length === 0 ? (
            <div className="p-6 text-center text-sm text-ink-300">
              No tickets yet.
            </div>
          ) : (
            <ul className="divide-y divide-ink-500/60">
              {tickets.map((t) => (
                <TicketRow key={t.id} t={t} />
              ))}
            </ul>
          )}
        </div>

        {/* Footer controls: total + load more */}
        <div className="mt-4 flex items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-widest text-ink-300">
          <div>
            {total} ticket{total === 1 ? "" : "s"} loaded
            {q.hasNextPage ? " · more available" : ""}
          </div>
          {q.hasNextPage ? (
            <button
              type="button"
              onClick={() => q.fetchNextPage()}
              disabled={q.isFetchingNextPage}
              className="rounded-lg border border-ink-500 px-3 py-2 text-ink-100 transition hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {q.isFetchingNextPage ? "loading…" : "load more"}
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function TicketRow({ t }: { t: Ticket }) {
  // Status: claimed > settled-won > settled-lost > pending
  const settled = t.winnings_amount !== null;
  const win =
    settled &&
    t.winnings_amount !== null &&
    BigInt(t.winnings_amount.amount) > 0n;
  const status: { label: string; tone: "accent" | "ink" } = !settled
    ? { label: "pending drawing", tone: "ink" }
    : win
      ? {
          label: t.claimed
            ? `won ${formatUsdcRaw(t.winnings_amount!.amount)} · claimed`
            : `won ${formatUsdcRaw(t.winnings_amount!.amount)}`,
          tone: "accent",
        }
      : { label: "no win", tone: "ink" };

  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-3 text-sm sm:px-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-ink-100">
            drawing #{t.round_id}
          </span>
          <span className="font-mono text-[11px] text-ink-300">
            {new Date(t.created_at).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
        </div>
        <div className="mt-1 font-mono text-[12px] text-ink-200">
          picks {t.normals.join(" · ")}{" "}
          <span className="text-accent">★ {t.bonusball}</span>
          {t.matched_normals !== null ? (
            <span className="text-ink-300">
              {" "}
              · matched {t.matched_normals}/5
              {t.bonusball_match ? " + ★" : ""}
            </span>
          ) : null}
        </div>
        <div className="mt-1 text-[11px] text-ink-300">
          <a
            href={`https://basescan.org/tx/${t.tx_hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono hover:text-accent"
          >
            {shortAddr(t.tx_hash)} ↗
          </a>
          {" · block "}
          <span className="font-mono">{t.block_number.toLocaleString()}</span>
        </div>
      </div>
      <div
        className={`shrink-0 text-right font-mono text-xs ${
          status.tone === "accent" ? "text-accent" : "text-ink-200"
        }`}
      >
        {status.label}
      </div>
    </li>
  );
}

// Tiny local helper so this page doesn't need formatUsdc's bigint coercion path.
function formatUsdcRaw(amount: string) {
  return formatUsdc(BigInt(amount), { dp: 2 });
}
