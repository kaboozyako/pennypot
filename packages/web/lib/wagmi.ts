import { getDefaultConfig } from "connectkit";
import { createConfig, http } from "wagmi";
import { base, mainnet } from "wagmi/chains";

// ConnectKit's getDefaultConfig wires up a sensible default wallet set (Injected,
// Coinbase Wallet, WalletConnect, Safe) plus storage + ssr glue. We just pass it
// through createConfig.
//
// WalletConnect requires a free project id from https://cloud.walletconnect.com.
// If unset, Injected + Coinbase Wallet still work; WalletConnect-based wallets
// will fail to connect.
const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "pennypot-dev-placeholder";

// Frontend RPC endpoints are hardcoded to Alchemy. The key ships in the client
// bundle either way (NEXT_PUBLIC_* is inlined at build), so there's nothing to
// hide here. The Alchemy app behind this key must have BOTH Base and Ethereum
// Mainnet enabled — Base for all contract reads/writes, Ethereum Mainnet (chain
// 1) for ConnectKit's ENS name/avatar resolution. If mainnet isn't enabled the
// ENS endpoint 403s and floods the console.
const ALCHEMY_KEY = "K6f2Iq8QM9Vx5laNF09_P";
const baseRpcUrl = `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;
const mainnetRpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;

export const wagmiConfig = createConfig(
  getDefaultConfig({
    appName: "PennyPot",
    appDescription: "1¢ shares of Megapot lottery tickets on Base",
    appUrl: "https://github.com/andreitr/pennypot",
    walletConnectProjectId: projectId,
    chains: [base, mainnet],
    transports: {
      [base.id]: http(baseRpcUrl),
      [mainnet.id]: http(mainnetRpcUrl),
    },
    ssr: true,
  }),
);
