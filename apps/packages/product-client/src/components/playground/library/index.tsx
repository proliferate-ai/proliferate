import { PRIMITIVES_TIER } from "./primitives";
import { PATTERNS_TIER } from "./patterns";
import { ICONS_TIER } from "./icons";
import { PRODUCT_PATTERNS_TIER } from "./product-patterns";
import type { LibraryTier } from "./types";

export type { LibraryEntry, LibraryTier } from "./types";

/** Every sanctioned component tier, in sheet display order. */
export const LIBRARY_TIERS: LibraryTier[] = [
  PRIMITIVES_TIER,
  PATTERNS_TIER,
  ICONS_TIER,
  PRODUCT_PATTERNS_TIER,
];
