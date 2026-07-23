import type { Config } from "tailwindcss";

// Penny-arcade aesthetic: dark canvas, hot-pink accent, monospace amounts.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Hot pink — penny arcade vibe.
        accent: {
          DEFAULT: "#ff2d88",
          glow: "#ff66ad",
          dim: "#7a1545",
        },
        ink: {
          900: "#050505",
          800: "#0a0a0a",
          700: "#101010",
          600: "#1a1a1a",
          500: "#262626",
          400: "#404040",
          300: "#737373",
          200: "#a3a3a3",
          100: "#e5e5e5",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "Courier New",
          "monospace",
        ],
      },
      boxShadow: {
        glow: "0 0 24px rgba(255,45,136,0.45), 0 0 4px rgba(255,45,136,0.7)",
      },
      keyframes: {
        pop: {
          "0%": { transform: "scale(1)" },
          "30%": { transform: "scale(1.08)" },
          "100%": { transform: "scale(1)" },
        },
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 0 rgba(255,45,136,0)" },
          "50%": { boxShadow: "0 0 18px rgba(255,45,136,0.65)" },
        },
      },
      animation: {
        pop: "pop 280ms ease-out",
        pulseGlow: "pulseGlow 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
