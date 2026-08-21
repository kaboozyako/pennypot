import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

// Absolute base for OG/Twitter image URLs. Prefer the Vercel production domain;
// fall back to localhost in dev. (opengraph-image.tsx / twitter-image.tsx supply
// the actual card art.)
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

const title = "PennyPot — 1¢ shares of Megapot tickets";
const description =
  "Buy 1¢ shares of Megapot lottery tickets on Base. Pooled, undersubscription-amplified, on-chain.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
    siteName: "PennyPot",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },

  other: {
    'base:app_id': '6a88130c39d7d26f4bad15db',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-ink-900 text-ink-100" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}