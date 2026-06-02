// Twitter card reuses the Open Graph image art (same dynamic jackpot render).
// Route-segment config (runtime/revalidate) and image metadata must be declared
// directly here — Next can't statically parse them through a re-export — so only
// the rendering function is re-exported.
export { default } from "./opengraph-image";

export const runtime = "nodejs";
export const revalidate = 300;
export const alt = "PennyPot — today's Megapot jackpot, 1¢ a share on Base";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
