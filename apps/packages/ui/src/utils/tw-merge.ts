import { extendTailwindMerge } from "tailwind-merge";

/**
 * Custom `text-*` FONT-SIZE tokens from the design package (@theme in
 * dom.css). tailwind-merge's default config only knows the stock sizes
 * (text-xs…text-9xl), so it classifies unknown `text-*` classes as text
 * COLORS — and then silently drops them whenever a real color (e.g.
 * text-muted-foreground) appears later in the same merge. Every custom size
 * token must be listed here or it will vanish from merged class lists.
 */
export const TEXT_SIZE_TOKEN_IDS = [
  "ui",
  "ui-sm",
  "composer",
  "title",
  "hero",
  "chat",
] as const;

/**
 * The one true twMerge: knows the design-package font-size tokens. Import it
 * from here — never from "tailwind-merge" directly (check-design-system.sh
 * enforces this repo-wide).
 */
export const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...TEXT_SIZE_TOKEN_IDS] }],
    },
  },
});
