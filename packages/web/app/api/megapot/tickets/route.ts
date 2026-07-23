import type { NextRequest } from "next/server";
import { PENNYPOT_ADDRESS } from "@/lib/addresses";

// Proxy `GET https://api.megapot.io/v1/wallets/<PENNYPOT>/tickets` so the
// MEGAPOT_API_KEY stays server-side. Forwards `limit` and `cursor` straight
// through. If no key is set, falls back to anonymous (rate-limited to
// 10 req/min by Megapot; fine for low-traffic browsing).
const MEGAPOT_API = "https://api.megapot.io/v1";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = searchParams.get("limit") ?? "25";
  const cursor = searchParams.get("cursor");

  const upstream = new URL(
    `${MEGAPOT_API}/wallets/${PENNYPOT_ADDRESS}/tickets`,
  );
  upstream.searchParams.set("limit", limit);
  if (cursor) upstream.searchParams.set("cursor", cursor);

  const headers: Record<string, string> = { accept: "application/json" };
  const apiKey = process.env.MEGAPOT_API_KEY;
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  let res: Response;
  try {
    res = await fetch(upstream.toString(), { headers, cache: "no-store" });
  } catch (e) {
    return Response.json(
      { error: { code: "upstream_unreachable", message: (e as Error).message } },
      { status: 502 },
    );
  }

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: {
      "content-type":
        res.headers.get("content-type") ?? "application/json",
      // Forward the rate-limit signals so the client can be polite if needed.
      ...(res.headers.get("x-ratelimit-remaining")
        ? {
            "x-ratelimit-remaining":
              res.headers.get("x-ratelimit-remaining") ?? "",
          }
        : {}),
      ...(res.headers.get("retry-after")
        ? { "retry-after": res.headers.get("retry-after") ?? "" }
        : {}),
    },
  });
}
