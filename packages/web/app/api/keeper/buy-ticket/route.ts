import { maybeBuyNextTicket } from "@/lib/keeper";

// Push-on-fill trigger. The frontend POSTs here the instant a share purchase
// fills the active ticket (sold == 100), so the next ticket is fronted within
// seconds instead of waiting for the backstop cron.
//
// Intentionally public (no CRON_SECRET): it's safe for anyone to call because
// maybeBuyNextTicket only sends a transaction when getState().canBuyNextTicket
// is true — exactly the action we want — and the contract bounds it to one buy
// per fill. A concurrent cron/trigger race is defused by nonce handling (the
// loser is rejected before mining), so the worst case is an occasional cheap
// revert, never a double buy.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST() {
  const result = await maybeBuyNextTicket();
  const status =
    result.action === "error" || result.action === "abort" ? 500 : 200;
  return Response.json(result, { status });
}
