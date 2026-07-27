// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { IntegrationIcon } from "#product/components/settings/panes/integrations/IntegrationIcon";

/** Seed namespaces whose logos ship as image assets. */
const IMAGE_NAMESPACES = [
  "notion",
  "context7",
  "exa",
  "gitlab",
  "render",
  "neon",
  "axiom",
  "posthog",
  "sentry",
  "supabase",
] as const;

/** Seed namespaces whose logos render as inline monochrome glyphs. */
const GLYPH_NAMESPACES = ["linear", "slack", "tavily"] as const;

describe("IntegrationIcon", () => {
  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.mode;
  });

  it("renders an image logo for every image-backed seed namespace", () => {
    for (const namespace of IMAGE_NAMESPACES) {
      const { container, unmount } = render(<IntegrationIcon namespace={namespace} />);
      const img = container.querySelector("img");
      expect(img, `expected image logo for ${namespace}`).toBeTruthy();
      expect(img?.getAttribute("aria-hidden")).toBe("true");
      unmount();
    }
  });

  it("renders a brand glyph (not the generic fallback) for glyph seed namespaces", () => {
    for (const namespace of GLYPH_NAMESPACES) {
      const { container, unmount } = render(<IntegrationIcon namespace={namespace} />);
      const svg = container.querySelector("svg");
      expect(svg, `expected brand glyph for ${namespace}`).toBeTruthy();
      // The generic fallback is a lucide icon; brand glyphs are bespoke paths.
      expect(
        svg?.classList.contains("lucide"),
        `expected a bespoke brand glyph for ${namespace}, got the lucide fallback`,
      ).toBe(false);
      unmount();
    }
  });

  it("swaps to the dark asset variant when the resolved mode is dark", () => {
    document.documentElement.dataset.mode = "light";
    const light = render(<IntegrationIcon namespace="render" />);
    const lightSrc = light.container.querySelector("img")?.getAttribute("src");
    light.unmount();

    document.documentElement.dataset.mode = "dark";
    const dark = render(<IntegrationIcon namespace="render" />);
    const darkSrc = dark.container.querySelector("img")?.getAttribute("src");

    expect(lightSrc).toBeTruthy();
    expect(darkSrc).toBeTruthy();
    expect(darkSrc).not.toBe(lightSrc);
  });

  it("falls back to a generic lucide glyph for unknown namespaces", () => {
    const { container } = render(<IntegrationIcon namespace="some_custom_mcp" />);
    expect(container.querySelector("img")).toBeNull();
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.classList.contains("lucide")).toBe(true);
  });

  it("applies caller classes on the tile", () => {
    const { container } = render(
      <IntegrationIcon namespace="linear" className="rounded-2xl" />,
    );
    const tile = container.firstElementChild;
    expect(tile?.className).toContain("rounded-2xl");
    expect(tile?.className).not.toContain("rounded-md");
  });

  /**
   * Regression for the "padding is weird / slack is gigantic" report: the
   * image branch and the glyph branch used to build their own divergent
   * class strings (an inset-free `size-full` image vs. a font-size-driven
   * `[&_svg]:icon-large` glyph), so artwork landed at inconsistent optical
   * sizes across the same row. Both branches must now share the identical
   * tile shell and resolve their artwork from a single semantic `icon-*`
   * tier each, so a future provider can't silently regress to one branch's
   * old full-bleed sizing.
   */
  it("resolves artwork sizing from a single shared rule per branch, not divergent per-provider classes", () => {
    const tileClasses = new Set<string>();
    const artworkSizeClasses = new Set<string>();

    for (const namespace of [...IMAGE_NAMESPACES, ...GLYPH_NAMESPACES]) {
      const { container, unmount } = render(<IntegrationIcon namespace={namespace} />);
      const tile = container.firstElementChild;
      expect(tile, `expected a tile wrapper for ${namespace}`).toBeTruthy();

      // Every tile shares the same overflow/rounding/flex shell regardless of
      // which artwork branch rendered inside it.
      expect(tile?.className).toContain("overflow-hidden");
      expect(tile?.className).toContain("rounded-lg");
      tileClasses.add(
        tile?.className
          .split(" ")
          .filter((cls) => !cls.startsWith("bg-"))
          .sort()
          .join(" ") ?? "",
      );

      const artwork = container.querySelector("img, svg");
      expect(artwork, `expected artwork for ${namespace}`).toBeTruthy();
      const sizeClass = artwork?.getAttribute("class")
        ?.split(" ")
        .find((cls) => cls.startsWith("icon-"));
      expect(sizeClass, `expected a semantic icon-* artwork class for ${namespace}`).toBeTruthy();
      artworkSizeClasses.add(sizeClass ?? "");

      unmount();
    }

    // The tile shell (minus tone background, which legitimately differs per
    // provider/dark-mode) is identical across every namespace and branch.
    expect(tileClasses.size).toBe(1);

    // Each branch resolves to exactly one artwork tier shared by every
    // provider in that branch — not a per-provider or fully-unified value,
    // since the glyph branch intentionally sits one tier down (see
    // GLYPH_ARTWORK_CLASS in IntegrationIcon.tsx).
    expect(artworkSizeClasses.size).toBe(2);
  });
});
