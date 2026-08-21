"use client";

import { formatUsdc } from "@/lib/format";
import { useMegapotDrawingTime } from "@/lib/hooks";

// Jackpot headline only. The active ticket + buy controls live together in the
// Buy card directly below — you can only buy shares of an active ticket, so the
// two are one card.
export function Hero() {
  const { topPrize } = useMegapotDrawingTime();

  return (
    <section className="relative z-10 mx-auto w-full max-w-3xl px-4 pt-16 pb-14 text-center sm:pt-24 sm:pb-20">
      {/* Top prize tier — Megapot PayoutCalculator.getExpectedDrawingTierPayouts[11]
          (5 normals + bonusball, i.e. the jackpot tier per-ticket payout). */}
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink-300">
        Today's Jackpot
      </div>
      <div className="mt-1 font-mono text-5xl font-black tracking-tighter text-accent drop-shadow-[0_0_22px_rgba(255,191,0,0.55)] sm:text-7xl">
        {topPrize !== undefined ? formatUsdc(topPrize, { dp: 0 }) : "—"}
      </div>
      <p 
  className="mt-4 text-sm text-ink-200 text-center tracking-wide" 
  style={{ fontFamily: '"Rye", serif' }}
>
  1¢ buys 1% of a Megapot ticket. Empty seats grow your slice. Come back after the drawing to claim.
</p>
    </section>
  );
}
