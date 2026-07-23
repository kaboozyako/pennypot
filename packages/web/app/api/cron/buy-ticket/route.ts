import type { NextRequest } from "next/server";
import { maybeBuyNextTicket } from "@/lib/keeper";

// Backstop keeper cron: every few minutes (see vercel.json), front the next
// Megapot ticket if one is buyable. The common fill-driven case is handled
// faster by the push-on-fill trigger (/api/keeper/buy-ticket); this cron exists
// for the cases with no fill event — a passed selling deadline, a newly-opened
// drawing, or the first ticket when there's no active one.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  // Vercel Cron attaches `Authorization: Bearer <CRON_SECRET>` when configured.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await maybeBuyNextTicket();
  const status =
    result.action === "error" || result.action === "abort" ? 500 : 200;
  return Response.json(result, { status });
}
