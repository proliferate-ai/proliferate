import type { Config } from "tailwindcss";

// Tailwind v4 uses CSS-based configuration via @theme in index.css.
// This file is kept for tooling compatibility only.
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
} satisfies Config;
