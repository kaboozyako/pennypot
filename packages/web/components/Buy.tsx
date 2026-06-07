"use client";

import NumberFlow from "@number-flow/react";
import { useQueryClient } from "@tanstack/react-query";
import { useModal } from "connectkit";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { base } from "wagmi/chains";
import { erc20Abi, pennypotAbi } from "@/lib/abis";
import { PENNYPOT_ADDRESS, USDC_ADDRESS } from "@/lib/addresses";
import { formatUsdc } from "@/lib/format";
import {
  CONSTS,
  useGetState,
  useMegapotDrawingTime,
  useTicketPicks,
  useUsdc,
} from "@/lib/hooks";

type Step = "idle" | "approving" | "buying" | "done";

const pad2 = (n: number) => String(n).padStart(2, "0");

// Variant C "Amplify" active-ticket card from the design handoff: mechanic-
// forward — the projected payout is the hero, a ring shows your growing slice,
// and an amplification badge makes "empty seats grow your slice" visceral.
// Wired to real data: jackpot tier, ticket picks, sold count, live countdown,
// and the on-chain approve → buyTicketShares flow.
export function Buy() {
  const { address } = useAccount();
  const chainId = useChainId();
  const wrongChain = !!address && chainId !== base.id;
  const queryClient = useQueryClient();
  const publicClient = usePublicClient({ chainId: base.id });
  const { setOpen } = useModal();
  const { switchChain } = useSwitchChain();
  const { data: state } = useGetState();
  const { drawingTime, topPrize } = useMegapotDrawingTime();
  const usdc = useUsdc(address);
  const [count, setCount] = useState(0);
  const [step, setStep] = useState<Step>("idle");
  const [errMsg, setErrMsg] = useState<string | undefined>();

  const ticketId = state?.[1];
  const sold = state?.[2] ?? 0;
  const canBuy = state?.[4] ?? false;
  const paused = state?.[6] ?? false;

  // Lottery picks for the active ticket (the numbered balls).
  const picks = useTicketPicks(ticketId);

  // Shares the connected user already holds on this ticket — folded into the
  // slice so "your slice" reflects total ownership, not just the new buy.
  const myShares = useReadContract({
    chainId: base.id,
    address: PENNYPOT_ADDRESS,
    abi: pennypotAbi,
    functionName: "getTicketShares",
    args:
      address && ticketId !== undefined ? [ticketId, address] : undefined,
    query: {
      enabled: !!address && ticketId !== undefined,
      refetchInterval: 15_000,
    },
  });
  const owned = (myShares.data as number | undefined) ?? 0;

  // Selling-shares window: active ticket exists, not full, deadline not passed.
  const sellingActive =
    !paused && ticketId !== undefined && ticketId > 0n && sold < 100 && !canBuy;

  // No sellable ticket now, but the drawing is live and a keeper is fronting the
  // next one (no first ticket yet, current sold out, or next is buyable now).
  const awaitingNextTicket =
    !paused &&
    (ticketId === 0n ||
      (ticketId !== undefined && ticketId > 0n && sold >= 100) ||
      canBuy);

  // ── live buy calculation (mirrors the design's useBuy) ──────────────────
  const remaining = Math.max(1, CONSTS.SHARES_PER_TICKET - sold); // shares left
  const cappedCount = Math.max(0, Math.min(count, remaining));
  const costUsdc = BigInt(cappedCount) * CONSTS.SHARE_PRICE_USDC;
  // "Your slice" = your share of a FULL 100-share ticket (1¢ = 1%), counting
  // shares you ALREADY own on this ticket plus the new buy.
  const ownedAfter = Math.min(owned + cappedCount, CONSTS.SHARES_PER_TICKET);
  const slice = ownedAfter / CONSTS.SHARES_PER_TICKET;
  // Shares already held by OTHERS on this ticket (current sold minus yours),
  // shown as a second pie segment.
  const others = Math.max(0, sold - owned);
  const othersSlice = others / CONSTS.SHARES_PER_TICKET;
  // Open seats left after your selection (mine + others + open = 100).
  const openSeats = Math.max(
    0,
    CONSTS.SHARES_PER_TICKET - sold - cappedCount,
  );
  const jackpotUsd = topPrize !== undefined ? Number(topPrize) / 1e6 : undefined;
  const winUsd = jackpotUsd !== undefined ? slice * jackpotUsd : undefined;
  const fillPct = (cappedCount / remaining) * 100; // slider fill

  // Date of the current drawing's close (e.g. "July 1, 2026").
  const drawingDate =
    drawingTime !== undefined
      ? new Date(Number(drawingTime) * 1000).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : undefined;

  const usdcBalance = usdc.data?.[0]?.result as bigint | undefined;
  const allowance = usdc.data?.[1]?.result as bigint | undefined;
  const needsApprove = allowance !== undefined && allowance < costUsdc;
  const insufficientBalance =
    usdcBalance !== undefined && usdcBalance < costUsdc;

  const { writeContractAsync } = useWriteContract();

  const inFlight = step === "approving" || step === "buying";

  // One-click flow: if allowance < cost, approve → wait → buy; else just buy.
  // Each step waits for on-chain confirmation; a single sonner toast morphs
  // through the steps. After the receipt we block-anchor a getState poll to
  // defeat load-balanced RPC lag, then invalidate so the UI updates with the toast.
  async function handleBuy() {
    if (!ticketId || cappedCount === 0 || !publicClient) return;
    setErrMsg(undefined);
    const toastId = toast.loading(
      needsApprove
        ? `Approving USDC ${formatUsdc(costUsdc)}… (confirm in wallet)`
        : `Buying ${cappedCount} share${cappedCount === 1 ? "" : "s"}… (confirm in wallet)`,
    );
    try {
      if (needsApprove) {
        setStep("approving");
        const hash = await writeContractAsync({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [PENNYPOT_ADDRESS, costUsdc],
        });
        toast.loading(`Waiting for USDC approval to confirm on-chain…`, {
          id: toastId,
        });
        await publicClient.waitForTransactionReceipt({ hash });
        // Let the freshly-confirmed allowance propagate before sending the buy.
        // Wallet simulators (e.g. Rainbow) read from their own indexer, which can
        // lag a block behind ours — they then see allowance still 0 and falsely
        // warn "simulation failed, the transaction will most likely fail." Poll
        // our RPC until the allowance is observable, then wait a short extra beat
        // for slower third-party simulation backends to catch up. Bounded ~6s.
        if (address) {
          for (let i = 0; i < 12; i++) {
            try {
              const a = (await publicClient.readContract({
                address: USDC_ADDRESS,
                abi: erc20Abi,
                functionName: "allowance",
                args: [address, PENNYPOT_ADDRESS],
              })) as bigint;
              if (a >= costUsdc) break;
            } catch {
              // RPC lag — retry.
            }
            await new Promise((r) => setTimeout(r, 400));
          }
          await new Promise((r) => setTimeout(r, 1200));
        }
        toast.loading(
          `Buying ${cappedCount} share${cappedCount === 1 ? "" : "s"}… (confirm in wallet)`,
          { id: toastId },
        );
      }
      setStep("buying");
      const buyHash = await writeContractAsync({
        address: PENNYPOT_ADDRESS,
        abi: pennypotAbi,
        functionName: "buyTicketShares",
        args: [ticketId, cappedCount],
      });
      toast.loading(`Waiting for purchase to confirm on-chain…`, {
        id: toastId,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: buyHash,
      });

      // The receipt returns as soon as ONE RPC sees the tx, but subsequent
      // reads can hit a load-balanced node a block or two behind. Poll getState
      // anchored to the receipt's block until the new sold count (or a ticket
      // roll-over) is observable, then invalidate. Bounded to ~6s.
      const targetSold = sold + cappedCount;
      for (let i = 0; i < 12; i++) {
        try {
          const s = (await publicClient.readContract({
            address: PENNYPOT_ADDRESS,
            abi: pennypotAbi,
            functionName: "getState",
            blockNumber: receipt.blockNumber,
          })) as readonly [
            bigint,
            bigint,
            number,
            bigint,
            boolean,
            bigint,
            boolean,
          ];
          if (s[2] >= targetSold || s[1] !== ticketId) break;
        } catch {
          // RPC doesn't have that block yet — wait and retry.
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      // If this purchase filled the ticket, nudge the keeper to front the next
      // one immediately instead of waiting for the backstop cron. Fire-and-forget.
      if (targetSold >= CONSTS.SHARES_PER_TICKET) {
        fetch("/api/keeper/buy-ticket", { method: "POST" }).catch(() => {});
      }

      queryClient.invalidateQueries();
      toast.success(
        `Bought ${cappedCount} share${cappedCount === 1 ? "" : "s"} for ${formatUsdc(costUsdc)}`,
        {
          id: toastId,
          description: `Ticket purchase confirmed on Base.`,
          duration: 6000,
        },
      );
      setStep("done");
      setTimeout(() => setStep("idle"), 1800);
    } catch (e) {
      const msg = (e as Error).message.split("\n")[0];
      const userRejected = /reject|denied|user/i.test(msg);
      toast.error(userRejected ? "Wallet rejected the request" : "Purchase failed", {
        id: toastId,
        description: userRejected ? undefined : msg.slice(0, 180),
      });
      setStep("idle");
      setErrMsg(msg);
    }
  }

  const buyButtonLabel =
    step === "approving"
      ? "Approving USDC…"
      : step === "buying"
        ? `Buying ${cappedCount} share${cappedCount === 1 ? "" : "s"}…`
        : step === "done"
          ? "✓ Confirmed"
          : `Buy ${cappedCount} share${cappedCount === 1 ? "" : "s"} · ${formatUsdc(costUsdc)}`;

  return (
    <section className="relative z-10 mx-auto w-full max-w-3xl px-4 pb-8">
      <div className="rounded-[18px] border border-ink-500 bg-ink-700 p-5 shadow-[0_0_0_1px_rgba(255,45,136,0.05),0_0_40px_rgba(255,45,136,0.06)] sm:p-[26px]">
        {paused ? (
          <p className="text-accent">Contract is paused.</p>
        ) : awaitingNextTicket ? (
          <div className="flex items-center gap-4">
            <Spinner />
            <div className="min-w-0">
              <div className="text-lg font-medium text-ink-100 sm:text-xl">
                Loading next ticket
              </div>
              <div className="mt-1 text-sm text-ink-300">
                A fresh Megapot ticket is being purchased. Shares open in a
                moment.
              </div>
            </div>
          </div>
        ) : !sellingActive ? (
          <p className="text-ink-200">
            Selling is paused for this drawing window. Check back after the next
            ticket is fronted.
          </p>
        ) : (
          <div className="flex flex-col gap-[18px]">
            {/* ── ticket section: status line + numbers ── */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-300">
                <span>
                  Selling ticket shares for{" "}
                  {drawingDate ? (
                    <span className="font-bold text-accent">{drawingDate}</span>
                  ) : (
                    "the next drawing"
                  )}
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                {picks.data ? (
                  <Balls
                    normals={picks.data.normals}
                    bonusball={picks.data.bonusball}
                  />
                ) : (
                  <div className="font-mono text-xs text-ink-300">
                    loading numbers…
                  </div>
                )}
                <a
                  href="https://megapot.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Powered by Megapot — visit megapot.io"
                  className="group flex shrink-0 items-center self-center"
                >
                  {/* The badge SVG is monochrome; render it via a CSS mask so it
                      takes a real color — muted grey, white on hover. */}
                  <span
                    aria-hidden
                    className="block aspect-[125/34] h-11 bg-ink-300 transition-colors group-hover:bg-white"
                    style={{
                      maskImage: "url(/brand/powered-by-megapot.svg)",
                      maskRepeat: "no-repeat",
                      maskPosition: "center",
                      maskSize: "contain",
                      WebkitMaskImage: "url(/brand/powered-by-megapot.svg)",
                      WebkitMaskRepeat: "no-repeat",
                      WebkitMaskPosition: "center",
                      WebkitMaskSize: "contain",
                    }}
                  />
                </a>
              </div>
            </div>

            {/* full-bleed divider — separates ticket info from the purchase UI */}
            <div className="-mx-5 h-px bg-ink-500 sm:-mx-[26px]" />

            {/* hero: projected payout with the slice ring */}
            <div className="flex items-center gap-[22px] px-0.5 py-1.5">
              <Ring slice={slice} others={othersSlice} />
              <div className="flex flex-col gap-1">
                <Cap>Potential jackpot slice</Cap>
                <span className="font-mono text-[38px] font-bold leading-none tracking-[-0.01em] text-ink-100">
                  {winUsd !== undefined ? (
                    <NumberFlow
                      value={winUsd}
                      format={{
                        style: "currency",
                        currency: "USD",
                        maximumFractionDigits: 0,
                      }}
                    />
                  ) : (
                    "$—"
                  )}
                </span>
                <span className="mt-0.5 font-mono text-[13px]">
                  <span className="text-accent">{ownedAfter} mine</span>
                  <span className="text-ink-400"> · </span>
                  <span style={{ color: "#6c6c74" }}>{others} others</span>
                  {openSeats > 0 ? (
                    <>
                      <span className="text-ink-400"> · </span>
                      <span className="text-ink-200">
                        {openSeats} available
                      </span>
                    </>
                  ) : null}
                </span>
              </div>
            </div>

            {/* buy control — large grabbable slider, distinct from read-only bars */}
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <Cap>Drag to select shares</Cap>
                <span className="font-mono text-xs text-ink-200">
                  <b className="text-ink-100">{cappedCount}</b> / {remaining}
                </span>
              </div>
              <input
                type="range"
                className="pp-range"
                min={0}
                max={remaining}
                value={cappedCount}
                disabled={inFlight}
                onChange={(e) => setCount(Number(e.target.value))}
                aria-label="Shares to buy"
                style={{
                  background: `linear-gradient(90deg, #ff2d88 ${fillPct}%, #26262c ${fillPct}%)`,
                }}
              />
            </div>

            {/* primary action — adapts to wallet state */}
            <div className="flex flex-col gap-2">
              {!address ? (
                <button type="button" onClick={() => setOpen(true)} className={BUY_BTN}>
                  Connect wallet to buy
                </button>
              ) : wrongChain ? (
                <button
                  type="button"
                  onClick={() => switchChain({ chainId: base.id })}
                  className={BUY_BTN}
                >
                  Switch to Base to buy
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleBuy}
                  disabled={inFlight || cappedCount === 0 || insufficientBalance}
                  className={BUY_BTN}
                >
                  {buyButtonLabel}
                </button>
              )}

              {address && !wrongChain && insufficientBalance ? (
                <div className="font-mono text-sm text-accent">
                  Not enough USDC.
                </div>
              ) : null}

              {errMsg ? (
                <div className="break-all font-mono text-xs text-accent">
                  {errMsg}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// Full-width pink primary button (design: payout-shadow, dark on-pink text).
const BUY_BTN =
  "w-full rounded-xl bg-accent px-4 py-[15px] font-mono text-base font-bold text-[#10000a] shadow-[0_6px_20px_rgba(255,45,136,0.35)] transition hover:shadow-[0_8px_26px_rgba(255,45,136,0.5)] disabled:cursor-not-allowed disabled:opacity-50";

function Cap({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-300">
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <span
      role="status"
      aria-label="loading"
      className="h-9 w-9 shrink-0 animate-spin rounded-full border-2 border-ink-500 border-t-accent shadow-glow"
    />
  );
}

// The ticket's five numbers as outlined balls + a separator + the pink bonus ball.
function Balls({
  normals,
  bonusball,
}: {
  normals: number[];
  bonusball: number;
}) {
  return (
    <div className="flex items-center gap-2">
      {normals.map((n, i) => (
        <span
          key={`${i}-${n}`}
          className="flex h-11 w-11 items-center justify-center rounded-full border-[1.5px] border-white/20 font-mono text-[17px] font-bold tabular-nums tracking-[-0.02em] text-[#eaeaec]"
        >
          {pad2(n)}
        </span>
      ))}
      <span className="mx-px h-0.5 w-1.5 rounded-sm bg-ink-300" />
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent font-mono text-[17px] font-bold tabular-nums tracking-[-0.02em] text-[#10000a] shadow-[0_0_14px_rgba(255,45,136,0.55)]">
        {pad2(bonusball)}
      </span>
    </div>
  );
}

// 132px donut: pink = your slice, grey = held by others, dark track = unsold.
// Arcs animate as the slider moves.
function Ring({ slice, others }: { slice: number; others: number }) {
  const size = 132;
  const sw = 12;
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const yourLen = Math.min(1, slice) * c;
  const othersLen = Math.min(Math.max(0, 1 - slice), others) * c;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        {/* unsold (empty seats) */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#1d1d21"
          strokeWidth={sw}
        />
        {/* held by others — starts where your slice ends */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#6c6c74"
          strokeWidth={sw}
          strokeDasharray={`${othersLen} ${c}`}
          strokeDashoffset={-yourLen}
          style={{
            transition: "stroke-dasharray 0.12s ease, stroke-dashoffset 0.12s ease",
          }}
        />
        {/* your slice */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#ff2d88"
          strokeWidth={sw}
          strokeDasharray={`${yourLen} ${c}`}
          style={{
            transition: "stroke-dasharray 0.12s ease",
            filter: "drop-shadow(0 0 6px rgba(255,45,136,0.5))",
          }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-mono text-[26px] font-bold tabular-nums text-accent">
          {(slice * 100).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
