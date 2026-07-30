// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#product/hooks/theme/derived/use-resolved-mode", () => ({
  useResolvedMode: () => "dark" as const,
}));

const { IntegrationIcon } = await import(
  "#product/components/settings/panes/integrations/IntegrationIcon"
);

/**
 * The artwork must never be able to exceed the tile that clips it. Sizing both
 * in `em` made them independent — the tile took its box from the caller while
 * the artwork resolved its own em — so a tile one tier smaller than the artwork
 * cropped the mark. A share of the tile cannot invert, and these tests pin this
 * half of that arrangement: the component marks which branch its artwork is and
 * sizes nothing itself. The shares themselves are pinned in
 * integration-icon-shares.test.ts, which reads the design CSS under node.
 */
describe("IntegrationIcon", () => {
  afterEach(cleanup);

  function artworkFor(namespace: string): Element {
    render(<IntegrationIcon namespace={namespace} className="icon-paired" />);
    return screen.getByTestId("integration-icon-artwork");
  }

  it("hangs the tile's share rules off the tile class", () => {
    const tile = artworkFor("slack").parentElement;
    expect(tile?.className).toContain("integration-icon-tile");
  });

  it.each([
    ["slack", "image"],
    ["linear", "glyph"],
    ["definitely-unknown", "glyph"],
  ])("marks %s artwork as the %s branch and carries no size class", (namespace, branch) => {
    const artwork = artworkFor(namespace);
    expect(artwork.getAttribute("data-integration-icon-artwork")).toBe(branch);
    // `className` on an SVG element is an SVGAnimatedString, so read the
    // attribute to compare either branch the same way. Neither branch may size
    // itself: an em tier here is what let the artwork outgrow its tile.
    expect(artwork.getAttribute("class") ?? "").not.toMatch(/(?:^|\s)(?:size|icon)-/);
  });

  it("falls back to a plug glyph for an unknown namespace", () => {
    expect(artworkFor("definitely-unknown").tagName.toLowerCase()).toBe("svg");
  });
});
