"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectKitProvider } from "connectkit";
import { Toaster } from "sonner";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: true } },
});

export default function ClientProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider
          mode="dark"
          options={{ initialChainId: 8453 }}
          customTheme={{
            "--ck-accent-color": "#ff2d88",
            "--ck-accent-text-color": "#0a0a0a",
            "--ck-primary-button-background": "#ff2d88",
            "--ck-primary-button-color": "#0a0a0a",
            "--ck-primary-button-hover-background": "#ff66ad",
            "--ck-focus-color": "#ff2d88",
            "--ck-border-radius": "12px",
            "--ck-font-family":
              'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          }}
        >
          {children}
          <Toaster
            theme="dark"
            position="bottom-right"
            richColors
            closeButton
            toastOptions={{
              style: {
                background: "#101010",
                border: "1px solid #262626",
                color: "#e5e5e5",
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                fontSize: "12px",
              },
              classNames: {
                success: "!border-accent/60",
              },
            }}
          />
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
