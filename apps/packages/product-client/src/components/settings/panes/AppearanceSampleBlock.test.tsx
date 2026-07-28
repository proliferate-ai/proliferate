// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Regression lock for the Appearance pane's sample block. The pane exposes two
 * independent ramps — the UI font-size ladder and the readable-code ladder —
 * and this sample is the only place a reader can eyeball both at once. The bug
 * report this guards against ("code text isn't actually at the code size") is
 * a classification error: a UI-half element resolving to the code ramp/mono
 * family, a code-half element resolving to the UI ramp/sans family, or any
 * hardcoded pixel size bypassing either ramp. jsdom cannot resolve `var(...)`
 * to a computed pixel value, so this locks the semantic CLASS each element
 * carries — the same contract appearance-css-drift.test.ts locks for the
 * generated tokens those classes reference.
 */

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    clipboard: { writeText: vi.fn() },
  }),
}));

vi.mock("#product/hooks/ui/highlighting/use-highlighted-tokens", () => ({
  useHighlightedTokens: () => [
    [{ content: "type ThemeConfig = {" }],
    [{ content: "  surface: string;" }],
  ],
}));

import { AppearanceSampleBlock } from "#product/components/settings/panes/AppearanceSampleBlock";

afterEach(cleanup);

describe("AppearanceSampleBlock ramp classification", () => {
  it("puts every UI-half prose element on the UI ramp and the sans family", () => {
    const { getByText } = render(<AppearanceSampleBlock />);

    const heading = getByText("Sample heading");
    expect(heading.className).toContain("text-heading");
    expect(heading.className).not.toContain("font-mono");
    expect(heading.className).not.toContain("text-readable-code");

    const body = getByText(/Body text at the size agents and chat use/);
    expect(body.className).toContain("text-body");
    expect(body.className).not.toContain("font-mono");
    expect(body.className).not.toContain("text-readable-code");

    const secondary = getByText(/Secondary text, the size used/);
    expect(secondary.className).toContain("text-ui-sm");
    expect(secondary.className).not.toContain("font-mono");
    expect(secondary.className).not.toContain("text-readable-code");
  });

  it("puts the inline <code> inside prose on the code ramp and mono family, not the UI ramp", () => {
    // Inline code in a sentence is still code — it should read in the mono
    // family at the readable-code step, not inherit the surrounding
    // sans/UI-ramp prose. Deliberately excluded from the "no code ramp" checks
    // above.
    const { getByText } = render(<AppearanceSampleBlock />);

    const inlineCode = getByText("inline code");
    expect(inlineCode.tagName).toBe("CODE");
    expect(inlineCode.className).toContain("font-mono");
    expect(inlineCode.className).toContain("text-readable-code");
    expect(inlineCode.className).not.toContain("text-body");
    expect(inlineCode.className).not.toContain("text-ui");
  });

  it("puts the code half's line-number gutter and token content on the code ramp and mono family", () => {
    const { container } = render(<AppearanceSampleBlock />);

    // Line-number gutter cell (CodeBlockTokenContent's <td>).
    const gutterCell = container.querySelector("td.text-readable-code");
    expect(gutterCell).not.toBeNull();
    expect(gutterCell?.className).not.toContain("font-sans");

    // Token content wrapper carries font-mono + text-readable-code and every
    // token span beneath it inherits rather than setting its own size/family.
    const tokenWrapper = container.querySelector(".font-mono.text-readable-code");
    expect(tokenWrapper).not.toBeNull();

    const tokenSpans = container.querySelectorAll("td span span");
    expect(tokenSpans.length).toBeGreaterThan(0);
    for (const span of tokenSpans) {
      expect(span.className).toBe("");
    }
  });

  it("never authors a raw pixel font-size or a non-mono/non-sans family in the sample's own source", () => {
    // Belt-and-suspenders: the class assertions above prove the RENDERED
    // classification; this proves the SOURCE never introduces a literal that
    // would bypass either ramp (e.g. text-[13px] or an arbitrary font-family).
    const testDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(testDir, "AppearanceSampleBlock.tsx"), "utf8");

    const bannedStockTextSizeUtility = ["text", "xs"].join("-");
    expect(source).not.toContain(bannedStockTextSizeUtility);
    expect(source).not.toMatch(/text-\[[^\]]*px\]/);
    expect(source).not.toMatch(/font-\[[^\]]*\]/);
  });
});
