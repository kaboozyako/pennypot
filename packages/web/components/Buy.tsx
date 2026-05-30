"use client";

import NumberFlow from "@number-flow/react";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useWriteContract,
} from "wagmi";
import { base } from "wagmi/chains";
import { erc20Abi, pennypotAbi } from "@/lib/abis";
import { PENNYPOT_ADDRESS, USDC_ADDRESS } from "@/lib/addresses";
import { formatUsdc } from "@/lib/format";
import {
  CONSTS,
  useGetState,
  useTicket,
  useTicketPicks,
  useUsdc,
} from "@/lib/hooks";

type Step = "idle" | "approving" | "buying" | "done";

export function Buy() {
  const { address } = useAccount();
  const chainId = useChainId();
  const wrongChain = !!address && chainId !== base.id;
  const queryClient = useQueryClient();
  const publicClient = usePublicClient({ chainId: base.id });
  const { data: state } = useGetState();
  const usdc = useUsdc(address);
  const [count, setCount] = useState(10);
  const [step, setStep] = useState<Step>("idle");
  const [errMsg, setErrMsg] = useState<string | undefined>();

  const ticketId = state?.[1];
  const sold = state?.[2] ?? 0;
  const canBuy = state?.[4] ?? false;
  const paused = state?.[6] ?? false;

  // Active-ticket display: lottery picks (Data API) + holder count (on-chain).
  const picks = useTicketPicks(ticketId);
  const ticket = useTicket(ticketId);
  const holders = (ticket.data?.[1] as number | undefined) ?? 0;

  // Selling-shares window: active ticket exists, not full, deadline not passed.
  // We use !canBuyNextTicket as a proxy for "deadline not passed AND not full".
  const sellingActive =
    !paused && ticketId !== undefined && ticketId > 0n && sold < 100 && !canBuy;

  // No sellable ticket right now, but the drawing is live and a keeper is about
  // to front the next one: either there's no first ticket yet, the active ticket
  // just sold out, or the contract reports the next ticket can be bought now.
  // (Distinct from the "selling window closed" case, where nothing is imminent.)
  const awaitingNextTicket =
    !paused &&
    (ticketId === 0n ||
      (ticketId !== undefined && ticketId > 0n && sold >= 100) ||
      canBuy);

  // Cap to remaining capacity.
  const remaining = Math.max(0, CONSTS.SHARES_PER_TICKET - sold);
  const cappedCount = Math.max(0, Math.min(count, remaining));
  const costUsdc = BigInt(cappedCount) * CONSTS.SHARE_PRICE_USDC;

  const usdcBalance = usdc.data?.[0]?.result as bigint | undefined;
  const allowance = usdc.data?.[1]?.result as bigint | undefined;
  const needsApprove = allowance !== undefined && allowance < costUsdc;
  const insufficientBalance =
    usdcBalance !== undefined && usdcBalance < costUsdc;

  const { writeContractAsync } = useWriteContract();

  // EV-amplification hook: with `count` more shares sold, the buyer's slice is
  // count / (sold + count). Show it as a percentage.
  const sliceLabel = useMemo(() => {
    const denom = sold + cappedCount;
    if (cappedCount <= 0 || denom <= 0) return null;
    const pct = (cappedCount / denom) * 100;
    return `${cappedCount}/${denom} = ${pct.toFixed(1)}%`;
  }, [cappedCount, sold]);

  const inFlight = step === "approving" || step === "buying";
  const totalSteps = needsApprove ? 2 : 1;
  const currentStep =
    step === "approving" ? 1 : step === "buying" ? (needsApprove ? 2 : 1) : 0;

  // One-click flow: if allowance < cost, fire approve, wait, then fire buy.
  // Otherwise just fire buy. Each step waits for on-chain confirmation before
  // moving on; UI shows "Step 1/2 — approving" → "Step 2/2 — buying" → done.
  // A single sonner toast morphs through the steps so the user can follow along
  // even if they're scrolled away from the button.
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
      // reads can hit a load-balanced node a block or two behind — making the
      // Hero appear "stuck" for ~15s until the next refetchInterval. Poll
      // getState directly until the new sold count (or a ticket roll-over)
      // is observable, then invalidate. Bounded to ~6s.
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
      // one immediately instead of waiting for the backstop cron. Fire-and-
      // forget: the endpoint re-checks eligibility and no-ops if it's not
      // actually buyable.
      if (targetSold >= CONSTS.SHARES_PER_TICKET) {
        fetch("/api/keeper/buy-ticket", { method: "POST" }).catch(() => {});
      }

      // Now refresh every wagmi read so Hero, balance, allowance, claimable,
      // and positions all update — and fire the success toast simultaneously.
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

  const buttonLabel =
    step === "approving"
      ? `Step 1/2 — approving USDC ${formatUsdc(costUsdc)}…`
      : step === "buying"
        ? needsApprove
          ? `Step 2/2 — buying ${cappedCount} share${cappedCount === 1 ? "" : "s"}…`
          : `buying ${cappedCount} share${cappedCount === 1 ? "" : "s"}…`
        : step === "done"
          ? "✓ Confirmed"
          : needsApprove
            ? `Approve & Buy ${cappedCount} share${cappedCount === 1 ? "" : "s"} · ${formatUsdc(costUsdc)}`
            : `Buy ${cappedCount} share${cappedCount === 1 ? "" : "s"} · ${formatUsdc(costUsdc)}`;

  return (
    <section className="relative z-10 mx-auto w-full max-w-3xl px-4 pb-8">
      <h2 className="mb-3 px-1 font-mono text-xs uppercase tracking-[0.25em] text-ink-300">
        ▌ Active ticket
      </h2>

      <div className="rounded-2xl border border-ink-500 bg-ink-700/60 p-5 shadow-glow sm:p-7">
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
                A fresh Megapot ticket is being purchased — shares open in a
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
          <>
            {/* Active ticket — picks, fill, holders */}
            {picks.data ? (
              <TicketPicks
                normals={picks.data.normals}
                bonusball={picks.data.bonusball}
              />
            ) : null}

            <div className="mt-5 grid grid-cols-2 gap-4">
              <Stat
                label="Shares sold"
                mono
                value={
                  <span className="tabular-nums">
                    <NumberFlow value={sold} />/100
                  </span>
                }
              />
              <Stat
                label="Holders"
                mono
                value={
                  <span className="tabular-nums">
                    <NumberFlow value={holders} />
                  </span>
                }
              />
            </div>

            <div className="mt-5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-ink-600">
                <div
                  className="h-full bg-accent transition-[width] duration-500 ease-out"
                  style={{ width: `${sold}%` }}
                />
              </div>
            </div>

            {/* Divider between the ticket and the buy controls */}
            <div className="my-6 h-px bg-ink-500/60" />

            {!address ? (
              <p className="text-ink-200">Connect a wallet to buy shares.</p>
            ) : wrongChain ? (
              <p className="text-accent">
                Wallet is on the wrong network — switch to Base above to buy.
              </p>
            ) : (
              <>
                <SharesSlider
                  count={count}
                  max={remaining}
                  cost={costUsdc}
                  disabled={inFlight}
                  onChange={setCount}
                />

                {/* EV / undersubscription hook */}
                <div className="mt-5 rounded-lg border border-ink-500 bg-ink-800/70 p-3 font-mono text-sm">
                  {sliceLabel ? (
                    <>
                      <span className="text-ink-300">if ticket wins, your slice =</span>{" "}
                      <span className="text-accent">{sliceLabel}</span>{" "}
                      <span className="text-ink-300">of the prize</span>
                      <div className="mt-1 text-[11px] text-ink-300">
                        (current ticket {sold}/100 sold — undersubscription amplifies your payout per share)
                      </div>
                    </>
                  ) : (
                    <span className="text-ink-300">enter a count above</span>
                  )}
                </div>

                {/* CTA — single button orchestrates approve + buy when allowance is short */}
                <div className="mt-5">
                  <button
                    type="button"
                    onClick={handleBuy}
                    disabled={
                      inFlight || cappedCount === 0 || insufficientBalance
                    }
                    className="w-full rounded-xl bg-accent px-4 py-3 font-mono text-base font-bold text-ink-900 transition disabled:opacity-50 hover:shadow-glow sm:w-auto"
                  >
                    {buttonLabel}
                  </button>

                  {/* Two-step progress while a buy is in flight */}
                  {inFlight ? (
                    <div className="mt-3 flex items-center gap-3">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-600">
                        <div
                          className="h-full bg-accent transition-[width] duration-500 ease-out"
                          style={{
                            width:
                              step === "approving"
                                ? "45%"
                                : step === "buying"
                                  ? "100%"
                                  : "0%",
                          }}
                        />
                      </div>
                      <div className="shrink-0 font-mono text-[11px] uppercase tracking-widest text-ink-300">
                        confirmation {currentStep}/{totalSteps}
                      </div>
                    </div>
                  ) : null}

                  {insufficientBalance ? (
                    <div className="mt-2 text-sm text-accent">
                      Not enough USDC.
                    </div>
                  ) : null}

                  {needsApprove && !inFlight && step !== "done" ? (
                    <div className="mt-2 font-mono text-[11px] text-ink-300">
                      Two wallet confirmations: 1/ approve USDC, 2/ buy shares.
                    </div>
                  ) : null}
                </div>

                {errMsg ? (
                  <div className="mt-2 break-all text-xs text-accent">
                    {errMsg}
                  </div>
                ) : null}
                {step === "done" ? (
                  <div className="mt-2 text-xs text-accent">
                    Confirmed on-chain ✓
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function TicketPicks({
  normals,
  bonusball,
}: {
  normals: number[];
  bonusball: number;
}) {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {normals.map((n, i) => (
        <span
          key={`${i}-${n}`}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-ink-500 bg-ink-800/70 font-mono text-base font-bold text-ink-100"
        >
          {pad(n)}
        </span>
      ))}
      <span className="mx-1 text-ink-500">·</span>
      <span
        className="flex h-10 w-10 items-center justify-center rounded-full bg-accent font-mono text-base font-bold text-ink-900 shadow-glow"
        title="Bonusball"
      >
        {pad(bonusball)}
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-ink-300">
        {label}
      </div>
      <div
        className={[
          "mt-1 text-lg sm:text-xl font-semibold",
          mono ? "font-mono" : "",
          accent ? "text-accent" : "text-ink-100",
        ].join(" ")}
      >
        {value}
      </div>
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

function SharesSlider({
  count,
  max,
  cost,
  disabled,
  onChange,
}: {
  count: number;
  max: number;
  cost: bigint;
  disabled?: boolean;
  onChange: (n: number) => void;
}) {
  const safeMax = Math.max(1, max);
  const safeCount = Math.min(Math.max(1, count), safeMax);
  // Filled portion of the track, 0..100%
  const pct = safeMax > 1 ? ((safeCount - 1) / (safeMax - 1)) * 100 : 100;

  return (
    <div>
      {/* Big readout: current share count + cost — same baseline, same treatment.
          NumberFlow animates both as the slider is dragged. */}
      <div className="flex items-baseline justify-between gap-3 font-mono">
        <div>
          <NumberFlow
            value={safeCount}
            className="text-4xl font-bold text-accent"
          />{" "}
          <span className="text-sm text-ink-300">
            share{safeCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="text-right">
          <NumberFlow
            value={Number(cost) / 1e6}
            format={{ style: "currency", currency: "USD" }}
            className="text-4xl font-bold text-accent"
          />{" "}
          <span className="text-sm text-ink-300">cost</span>
        </div>
      </div>

      {/* Slider */}
      <input
        type="range"
        min={1}
        max={safeMax}
        step={1}
        value={safeCount}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Shares to buy"
        // Pink fill up to the thumb, dark beyond.
        style={{
          background: `linear-gradient(to right, #ff2d88 0%, #ff2d88 ${pct}%, #262626 ${pct}%, #262626 100%)`,
        }}
        className="
          mt-4 h-2 w-full cursor-pointer appearance-none rounded-full outline-none
          disabled:cursor-not-allowed disabled:opacity-50
          [&::-webkit-slider-runnable-track]:appearance-none [&::-webkit-slider-runnable-track]:bg-transparent
          [&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent
          [&::-webkit-slider-thumb]:shadow-glow [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-ink-900
          [&::-moz-range-track]:appearance-none [&::-moz-range-track]:bg-transparent
          [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:cursor-pointer
          [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent
          [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-ink-900
        "
      />
    </div>
  );
}
