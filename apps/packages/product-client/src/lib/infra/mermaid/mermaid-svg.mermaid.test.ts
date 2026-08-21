// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import mermaid from "mermaid";
import { sanitizeMermaidSvg } from "./mermaid-svg";

const FLOWCHART = [
  "flowchart TB",
  "  subgraph Pipeline",
  "    Frontend --> API",
  "    API -->|auth| Runtime",
  "  end",
].join("\n");

function stubSvgTextMetrics(): void {
  const proto = SVGElement.prototype as SVGElement & {
    getComputedTextLength?: () => number;
    getBBox?: () => DOMRect;
  };
  proto.getComputedTextLength = () => 48;
  proto.getBBox = () => ({
    x: 0,
    y: 0,
    width: 48,
    height: 16,
    bottom: 16,
    left: 0,
    right: 48,
    top: 0,
    toJSON() {
      return this;
    },
  }) as DOMRect;
}

describe("DOMPurify profile against mermaid 11 SVG", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("keeps mermaid markers, defs, style, paths, and internal url(#) refs", async () => {
    stubSvgTextMetrics();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
      suppressErrorRendering: true,
    });
    const parsed = await mermaid.parse(FLOWCHART, { suppressErrors: true });
    expect(parsed).not.toBe(false);
    const { svg } = await mermaid.render("p-mermaid-preserve", FLOWCHART);
    const sanitized = sanitizeMermaidSvg(svg);

    expect(svg).toMatch(/<style\b/i);
    expect(svg).toMatch(/<defs\b/i);
    expect(svg).toMatch(/<path\b/i);
    expect(sanitized).toMatch(/<style\b/i);
    expect(sanitized).toMatch(/<defs\b/i);
    expect(sanitized).toMatch(/<path\b/i);
    const urlRefs = svg.match(/url\(#([^)]+)\)/g) ?? [];
    expect(urlRefs.length).toBeGreaterThan(0);
    for (const ref of urlRefs) {
      expect(sanitized).toContain(ref);
    }
  }, 30_000);
});
