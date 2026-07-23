"use client";

import { useEffect, useRef } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";

/**
 * Keeps the wallet on Base.
 * - On first connect, auto-asks the wallet to switch to Base.
 * - If the user explicitly stays on another chain, renders a banner with a
 *   one-click switch button. Doesn't re-prompt automatically (no loops).
 */
export function NetworkBanner() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();
  const attempted = useRef(false);

  useEffect(() => {
    if (!isConnected) {
      attempted.current = false;
      return;
    }
    if (chainId !== base.id && !attempted.current) {
      attempted.current = true;
      switchChain({ chainId: base.id });
    }
  }, [isConnected, chainId, switchChain]);

  if (!isConnected || chainId === base.id) return null;

  return (
    <div className="mx-auto mt-2 w-full max-w-3xl px-4">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-accent/50 bg-accent/10 px-3 py-2 text-xs font-mono">
        <span>
          Wallet is on chain <span className="text-accent">{chainId}</span> —
          PennyPot is on Base.
        </span>
        <button
          type="button"
          onClick={() => switchChain({ chainId: base.id })}
          disabled={isPending}
          className="rounded-md bg-accent px-2 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-ink-900 disabled:opacity-50 hover:shadow-glow"
        >
          {isPending ? "switching…" : "Switch to Base"}
        </button>
      </div>
    </div>
  );
}
