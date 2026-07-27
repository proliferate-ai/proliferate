import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PRODUCT_CSS = readFileSync(
  new URL("../../../../../../design/src/css/product.css", import.meta.url),
  "utf8",
);

/**
 * The integration brand mark is sized as a share of the tile that clips it, and
 * that relationship lives in the design CSS (`.integration-icon-tile`) because
 * two independent em sizes could not express it: tile and artwork resolved
 * their ems against the same font size, pinning their ratio at whatever the two
 * tiers were — above 1 for a tile a tier below the artwork, so the mark grew
 * larger than the box clipping it. A share cannot invert, provided it stays
 * under 100%. This asserts that, since a share at or over 100% would silently
 * reintroduce the clipped-mark bug at every tile size at once.
 */
describe("integration icon tile shares", () => {
  it("keeps both artwork shares strictly inside the tile", () => {
    const shares = [
      ...PRODUCT_CSS.matchAll(/--integration-icon-[\w-]+-share:\s*(\d+(?:\.\d+)?)%/g),
    ].map((match) => Number(match[1]));

    // Exactly two: one per artwork branch (image asset, inline glyph).
    expect(shares.length).toBe(2);
    for (const share of shares) {
      expect(share).toBeGreaterThan(0);
      expect(share).toBeLessThan(100);
    }
  });
});
