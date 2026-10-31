import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        base: "rgb(var(--base-rgb) / <alpha-value>)",
        surface: "rgb(var(--surface-rgb) / <alpha-value>)",
        ink: {
          DEFAULT: "rgb(var(--text-rgb) / <alpha-value>)",
          muted: "rgb(var(--text-muted-rgb) / <alpha-value>)",
        },
        "ui-border": "rgb(var(--border-rgb) / <alpha-value>)",
        brand: {
          DEFAULT: "rgb(var(--accent-rgb) / <alpha-value>)",
          soft: "rgb(var(--accent-soft-rgb) / <alpha-value>)",
          foreground: "rgb(var(--on-accent-rgb) / <alpha-value>)",
        },
        analysis: {
          DEFAULT: "rgb(var(--analysis-rgb) / <alpha-value>)",
          soft: "rgb(var(--analysis-soft-rgb) / <alpha-value>)",
        },
        status: {
          ok: {
            DEFAULT: "rgb(var(--status-ok-rgb) / <alpha-value>)",
            bg: "rgb(var(--status-ok-bg-rgb) / <alpha-value>)",
            text: "rgb(var(--status-ok-text-rgb) / <alpha-value>)",
          },
          warn: {
            DEFAULT: "rgb(var(--status-warn-rgb) / <alpha-value>)",
            bg: "rgb(var(--status-warn-bg-rgb) / <alpha-value>)",
            text: "rgb(var(--status-warn-text-rgb) / <alpha-value>)",
          },
          critical: {
            DEFAULT: "rgb(var(--status-critical-rgb) / <alpha-value>)",
            bg: "rgb(var(--status-crit-bg-rgb) / <alpha-value>)",
            text: "rgb(var(--status-crit-text-rgb) / <alpha-value>)",
          },
          neutral: "rgb(var(--status-neutral-rgb) / <alpha-value>)",
        },
        "plan-track": "rgb(var(--plan-track-rgb) / <alpha-value>)",
        sidebar: {
          DEFAULT: "rgb(var(--sidebar-rgb) / <alpha-value>)",
          hover: "rgb(var(--sidebar-hover-rgb) / <alpha-value>)",
          text: "rgb(var(--sidebar-text-rgb) / <alpha-value>)",
          muted: "rgb(var(--sidebar-muted-rgb) / <alpha-value>)",
        },
        background: "rgb(var(--base-rgb) / <alpha-value>)",
        foreground: "rgb(var(--text-rgb) / <alpha-value>)",
        card: {
          DEFAULT: "rgb(var(--surface-rgb) / <alpha-value>)",
          foreground: "rgb(var(--text-rgb) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "rgb(var(--surface-rgb) / <alpha-value>)",
          foreground: "rgb(var(--text-rgb) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "rgb(var(--accent-rgb) / <alpha-value>)",
          foreground: "rgb(var(--on-accent-rgb) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "rgb(var(--plan-track-rgb) / <alpha-value>)",
          foreground: "rgb(var(--text-rgb) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "rgb(var(--plan-track-rgb) / <alpha-value>)",
          foreground: "rgb(var(--text-muted-rgb) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent-soft-rgb) / <alpha-value>)",
          foreground: "rgb(var(--accent-rgb) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "rgb(var(--status-critical-rgb) / <alpha-value>)",
          foreground: "rgb(var(--on-accent-rgb) / <alpha-value>)",
        },
        border: "rgb(var(--border-rgb) / <alpha-value>)",
        input: "rgb(var(--border-rgb) / <alpha-value>)",
        ring: "rgb(var(--accent-rgb) / <alpha-value>)",
        chart: {
          "1": "rgb(var(--accent-rgb) / <alpha-value>)",
          "2": "rgb(var(--status-ok-rgb) / <alpha-value>)",
          "3": "rgb(var(--analysis-rgb) / <alpha-value>)",
          "4": "rgb(var(--status-warn-rgb) / <alpha-value>)",
          "5": "rgb(var(--status-critical-rgb) / <alpha-value>)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
