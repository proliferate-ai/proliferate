// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { IntegrationIcon } from "./IntegrationIcon";

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

  it("applies caller sizing via className on the tile", () => {
    const { container } = render(
      <IntegrationIcon namespace="linear" className="size-10" />,
    );
    const tile = container.firstElementChild;
    expect(tile?.className).toContain("size-10");
    expect(tile?.className).not.toContain("size-8");
  });
});
