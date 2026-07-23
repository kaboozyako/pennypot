// USDC has 6 decimals on Base. All on-chain amounts in this app are USDC.
export const USDC_DECIMALS = 6;

export function formatUsdc(v: bigint | undefined | null, opts?: { dp?: number }) {
  if (v === undefined || v === null) return "—";
  const dp = opts?.dp ?? 2;
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(USDC_DECIMALS);
  const whole = abs / base;
  const frac = abs % base;
  // pad fraction to 6, then truncate to dp.
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0").slice(0, dp);
  const wholeWithCommas = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${wholeWithCommas}${dp > 0 ? "." + fracStr : ""}`;
}

// "in 6h 12m 03s" / "closed 0h 04m ago"
export function countdown(deadline: bigint | undefined | null, now: number) {
  if (!deadline || deadline === 0n) return { label: "—", ended: true };
  const dl = Number(deadline);
  const diff = dl - Math.floor(now / 1000);
  const ended = diff <= 0;
  const a = Math.abs(diff);
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const s = a % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  const body = `${h}h ${pad(m)}m ${pad(s)}s`;
  return { label: ended ? `closed ${body} ago` : `in ${body}`, ended };
}

export function shortAddr(a?: string) {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
