"use client";

import { ConnectKitButton } from "connectkit";
import { Buy } from "@/components/Buy";
import { CurrentRound } from "@/components/CurrentRound";
import { Hero } from "@/components/Hero";
import { NetworkBanner } from "@/components/NetworkBanner";
import { Positions } from "@/components/Positions";
import { PENNYPOT_ADDRESS } from "@/lib/addresses";

export default function Page() {
  return (
    <main className="relative z-10">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 pt-4">
        {/* Brand mark — fills the header band */}
        <a
          href="/"
          aria-label="PennyPot — home"
          className="flex items-center text-[1.458rem] leading-none tracking-wide sm:text-[1.944rem]"
          style={{ fontFamily: '"Rye", serif' }}
        >
          <span className="text-accent drop-shadow-[0_0_14px_rgba(255,191,0,0.6)]">
            PENNY
          </span>
          <span className="text-ink-100">POT</span>
        </a>
        <ConnectKitButton showBalance={false} />
      </header>

      <NetworkBanner />

      <section className="mx-auto w-full max-w-md px-4 mt-8 -mb-20 flex justify-center">
        <img 
          src="/banner.png" 
          alt="SMALL STEPS TO BIG WINS" 
          className="w-full h-auto drop-shadow-[0_0_20px_rgba(255,191,0,0.5)]" 
        />
      </section>

      <Hero />
      <Buy />
      <CurrentRound />
      <Positions />

      <footer className="mx-auto w-full max-w-3xl px-4 pb-12 pt-4 text-center text-[10px] uppercase tracking-[0.25em] text-ink-300">
        <a
          href="https://x.com/pennypotxyz"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-accent"
        >
          follow us on X ↗
        </a>
        <span className="mx-2">·</span>
        <a
          href={`https://basescan.org/address/${PENNYPOT_ADDRESS}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-accent"
        >
          contract on Basescan ↗
        </a>
        <span className="mx-2">·</span>
        <a
          href="https://megapot.io/r/RRQ4HJ"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-accent"
        >
          built on Megapot
        </a>
      </footer>
    </main>
  );
}