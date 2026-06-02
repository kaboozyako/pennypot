import { ImageResponse } from "next/og";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { jackpotAbi, payoutCalculatorAbi } from "@/lib/abis";
import { JACKPOT_ADDRESS } from "@/lib/addresses";

// Dynamic social-share card — mirrors the Hero: "TODAY'S JACKPOT" + the live
// top-prize tier + tagline, on the app's dark/hot-pink palette. Regenerated at
// most every 5 minutes so crawlers get a fresh number without hammering the RPC.
export const runtime = "nodejs";
export const revalidate = 300;
export const alt = "PennyPot — today's Megapot jackpot, 1¢ a share on Base";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Hardcoded Base RPC (same key as the client; it's public regardless).
const BASE_RPC = "https://base-mainnet.g.alchemy.com/v2/K6f2Iq8QM9Vx5laNF09_P";

// Read the current drawing's jackpot-tier payout (index 11) and format as USD.
// Returns null on any failure so the image still renders with a static headline.
async function getJackpotLabel(): Promise<string | null> {
  try {
    const client = createPublicClient({ chain: base, transport: http(BASE_RPC) });
    const drawingId = await client.readContract({
      address: JACKPOT_ADDRESS,
      abi: jackpotAbi,
      functionName: "currentDrawingId",
    });
    const st = await client.readContract({
      address: JACKPOT_ADDRESS,
      abi: jackpotAbi,
      functionName: "getDrawingState",
      args: [drawingId],
    });
    const tiers = await client.readContract({
      address: st.payoutCalculator,
      abi: payoutCalculatorAbi,
      functionName: "getExpectedDrawingTierPayouts",
      args: [drawingId, st.prizePool, st.ballMax, st.bonusballMax],
    });
    const top = tiers[11] as bigint;
    if (top <= 0n) return null;
    return `$${Math.round(Number(top) / 1e6).toLocaleString("en-US")}`;
  } catch {
    return null;
  }
}

// Load JetBrains Mono (bold + regular) to match the app's monospace look. WOFF
// is satori-compatible; on any fetch failure we fall back to the default font.
async function loadFonts() {
  const url = (w: number) =>
    `https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5/files/jetbrains-mono-latin-${w}-normal.woff`;
  try {
    const [bold, regular] = await Promise.all([
      fetch(url(700)).then((r) => {
        if (!r.ok) throw new Error("font 700");
        return r.arrayBuffer();
      }),
      fetch(url(400)).then((r) => {
        if (!r.ok) throw new Error("font 400");
        return r.arrayBuffer();
      }),
    ]);
    return [
      { name: "JetBrains Mono", data: bold, weight: 700 as const, style: "normal" as const },
      { name: "JetBrains Mono", data: regular, weight: 400 as const, style: "normal" as const },
    ];
  } catch {
    return undefined;
  }
}

export default async function Image() {
  const [jackpot, fonts] = await Promise.all([getJackpotLabel(), loadFonts()]);
  const hasNumber = jackpot !== null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#050505",
          backgroundImage:
            "radial-gradient(70% 58% at 50% 42%, rgba(255,45,136,0.22), rgba(5,5,5,0) 72%)",
          color: "#e5e5e5",
          fontFamily: "JetBrains Mono",
          padding: "56px 64px",
          position: "relative",
        }}
      >
        {/* wordmark */}
        <div style={{ display: "flex", fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>
          <span style={{ color: "#ff2d88" }}>PENNY</span>
          <span style={{ color: "#e5e5e5" }}>POT</span>
        </div>

        {/* center block */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
          }}
        >
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 9,
              color: "#737373",
            }}
          >
            TODAY&apos;S JACKPOT
          </div>
          <div
            style={{
              display: "flex",
              fontSize: hasNumber ? 150 : 86,
              fontWeight: 700,
              color: "#ff2d88",
              letterSpacing: hasNumber ? -4 : -2,
              marginTop: 10,
              lineHeight: 1,
              textShadow: "0 0 44px rgba(255,45,136,0.55)",
            }}
          >
            {jackpot ?? "Megapot Jackpot"}
          </div>
          <div
            style={{
              fontSize: 30,
              color: "#a3a3a3",
              marginTop: 30,
              maxWidth: 820,
              textAlign: "center",
              lineHeight: 1.35,
            }}
          >
            1¢ buys 1% of a Megapot ticket. Empty seats grow your slice.
          </div>
        </div>

        {/* accent baseline */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: "100%",
            height: 10,
            backgroundColor: "#ff2d88",
          }}
        />
      </div>
    ),
    { ...size, fonts },
  );
}
