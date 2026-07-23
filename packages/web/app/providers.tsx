"use client";

import dynamic from "next/dynamic";

// WalletConnect (pulled in by ConnectKit's default config) touches IndexedDB at
// connector construction, which doesn't exist in Node. We dynamic-import the
// whole wagmi/ConnectKit tree with ssr:false so its module is never loaded on
// the server. The loading fallback renders identical content on server and
// initial client paint to keep hydration stable.
const ClientProviders = dynamic(() => import("./client-providers"), {
  ssr: false,
  loading: () => <BootShell />,
});

export function Providers({ children }: { children: React.ReactNode }) {
  return <ClientProviders>{children}</ClientProviders>;
}

function BootShell() {
  return (
    <main className="relative z-10">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 pt-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink-300">
          PennyPot · Base
        </div>
        <div className="h-9 w-32 animate-pulseGlow rounded-md bg-ink-700" />
      </header>
      <div className="mx-auto w-full max-w-3xl px-4 pt-10 font-mono text-xs uppercase tracking-[0.25em] text-ink-300">
        loading wallet…
      </div>
    </main>
  );
}
