import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkeletonBlock } from "@/components/feedback/Skeleton";

const testDir = dirname(fileURLToPath(import.meta.url));
const domCss = readFileSync(
  resolve(testDir, "../../../../packages/design/src/css/dom.css"),
  "utf8",
);

describe("SkeletonBlock", () => {
  it("renders the shared shimmer block instead of the opacity pulse", () => {
    const html = renderToStaticMarkup(<SkeletonBlock className="h-2 w-24" />);

    expect(html).toContain("skeleton-shimmer");
    expect(html).not.toContain("animate-pulse");
    expect(html).toContain("h-2 w-24");
    expect(html).toContain('aria-hidden="true"');
  });

  it("supports --shimmer-delay row staggering via style", () => {
    const html = renderToStaticMarkup(
      <SkeletonBlock style={{ "--shimmer-delay": "120ms" } as CSSProperties} />,
    );

    expect(html).toContain("--shimmer-delay:120ms");
  });
});

describe("skeleton shimmer css contract", () => {
  it("sweeps via transform with a per-row delay knob (compositor-only)", () => {
    const start = domCss.indexOf("@keyframes skeleton-shimmer-sweep");
    expect(start).toBeGreaterThan(-1);
    const section = domCss.slice(start, domCss.indexOf("}", domCss.indexOf(".skeleton-shimmer::before")));

    expect(domCss).toContain(".skeleton-shimmer::before");
    expect(section).toContain("transform: translateX(-100%)");
    expect(section).toContain("transform: translateX(100%)");
    expect(section).toContain("animation-delay: var(--shimmer-delay, 0s)");
    expect(section).not.toContain("background-position");
    expect(section).not.toContain("steps(");
  });
});
