import { NextResponse } from "next/server";
import { PENNYPOT_ADDRESS } from "@/lib/addresses";

const MEGAPOT_API_BASE = "https://api.megapot.io/v1";
const MAX_PAGES = 20; // До 2000 квитків (20 сторінок по 100)

export async function GET() {
  const apiKey =
    process.env.MEGAPOT_API_KEY ||
    process.env.NEXT_PUBLIC_MEGAPOT_API_KEY ||
    "";

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers["apikey"] = apiKey;
  }

  const allTickets: unknown[] = [];
  let cursor: string | null = null;
  let firstEnvelope: Record<string, unknown> = {};

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(
        `${MEGAPOT_API_BASE}/wallets/${PENNYPOT_ADDRESS}/tickets`,
      );
      url.searchParams.set("limit", "100");
      if (cursor) {
        url.searchParams.set("cursor", cursor);
      }

      const res = await fetch(url.toString(), {
        headers,
        next: { revalidate: 15 },
      });

      if (!res.ok) {
        if (page === 0) {
          return NextResponse.json(
            { error: `Megapot API error: ${res.status}`, tickets: [], data: [] },
            { status: res.status },
          );
        }
        break;
      }

      const json = (await res.json()) as Record<string, unknown>;
      if (page === 0) {
        firstEnvelope = json;
      }

      const pageItems = Array.isArray(json.data)
        ? json.data
        : Array.isArray(json.tickets)
          ? json.tickets
          : Array.isArray(json)
            ? json
            : [];

      allTickets.push(...pageItems);

      const hasMore = Boolean(json.has_more);
      const nextCursor =
        typeof json.next_cursor === "string" && json.next_cursor.length > 0
          ? json.next_cursor
          : null;

      if (!hasMore || !nextCursor || pageItems.length === 0) {
        break;
      }
      cursor = nextCursor;
    }

    return NextResponse.json({
      ...firstEnvelope,
      data: allTickets,
      tickets: allTickets,
      has_more: false,
      next_cursor: null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, tickets: [], data: [] },
      { status: 500 },
    );
  }
}