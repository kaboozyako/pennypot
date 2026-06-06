import type { Address } from "viem";

// Base mainnet (chain id 8453). Defaults wired to the live PennyPot deployment;
// override via NEXT_PUBLIC_* env vars if you point at a different deployment.

const env = process.env;

export const PENNYPOT_ADDRESS = (env.NEXT_PUBLIC_PENNYPOT_ADDRESS ??
  "0x133195CEd7Cf71A7ed3a428a30816d83f022C9A1") as Address;

export const USDC_ADDRESS = (env.NEXT_PUBLIC_USDC_ADDRESS ??
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as Address;

export const JACKPOT_ADDRESS = (env.NEXT_PUBLIC_JACKPOT_ADDRESS ??
  "0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2") as Address;

// Megapot JackpotTicketNFT — each PennyPot ticket is an NFT here; used for
// per-ticket Basescan links in the positions list.
export const JACKPOT_TICKET_NFT_ADDRESS = (env.NEXT_PUBLIC_JACKPOT_TICKET_NFT_ADDRESS ??
  "0x48FfE35AbB9f4780a4f1775C2Ce1c46185b366e4") as Address;

// Floor for SharesBought log queries. Set NEXT_PUBLIC_PENNYPOT_DEPLOY_BLOCK to the
// exact deploy block for faster reads; the default is a safe earlier block on Base.
export const PENNYPOT_DEPLOY_BLOCK = BigInt(
  env.NEXT_PUBLIC_PENNYPOT_DEPLOY_BLOCK ?? "46992093",
);
