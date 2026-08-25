// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeMermaidSvg } from "./mermaid-svg";

const BENIGN_MERMAID_SHAPED_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" id="p-mermaid-1" viewBox="0 0 100 40">
  <style>#p-mermaid-1 .node { fill: currentColor; }</style>
  <defs>
    <marker id="p-mermaid-1-arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" />
    </marker>
  </defs>
  <g id="p-mermaid-1-graph">
    <rect class="node" id="p-mermaid-1-n1" x="1" y="1" width="20" height="10" />
    <path d="M21 6 L40 6" marker-end="url(#p-mermaid-1-arrow)" />
  </g>
</svg>
`;

describe("sanitizeMermaidSvg", () => {
  it("keeps mermaid drawing features: style, defs, markers, paths, and url(#) refs", () => {
    const sanitized = sanitizeMermaidSvg(BENIGN_MERMAID_SHAPED_SVG);

    expect(sanitized).toMatch(/<style\b/i);
    expect(sanitized).toMatch(/<defs\b/i);
    expect(sanitized).toMatch(/<marker\b/i);
    expect(sanitized).toMatch(/<path\b/i);
    expect(sanitized).toContain("url(#p-mermaid-1-arrow)");
    expect(sanitized).toContain('id="p-mermaid-1"');
    expect(sanitized).toContain('id="p-mermaid-1-arrow"');
  });

  it("hides the svg from the accessibility tree", () => {
    const sanitized = sanitizeMermaidSvg(BENIGN_MERMAID_SHAPED_SVG);
    expect(sanitized).toMatch(/<svg[^>]*aria-hidden="true"/i);
  });

  it("strips executable nodes and attributes from hostile SVG", () => {
    const hostile = `
      <svg xmlns="http://www.w3.org/2000/svg">
        <script>alert(1)</script>
        <foreignObject width="100" height="100"><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject>
        <a href="javascript:alert(1)" onclick="alert(1)">x</a>
        <a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">y</a>
        <a href="vbscript:alert(1)">z</a>
        <image href="javascript:alert(1)" />
        <path d="M0 0" onload="alert(1)" />
      </svg>
    `;
    const sanitized = sanitizeMermaidSvg(hostile);
    const host = document.createElement("div");
    host.innerHTML = sanitized;

    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("foreignObject")).toBeNull();
    expect(host.querySelector("[onclick]")).toBeNull();
    expect(host.querySelector("[onload]")).toBeNull();
    expect(Array.from(host.querySelectorAll("[href], [xlink\\:href]")).map((node) =>
      node.getAttribute("href") ?? node.getAttribute("xlink:href") ?? "",
    )).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/^(?:javascript|data|vbscript):/i),
    ]));
    expect(sanitized).not.toMatch(/javascript:/i);
    expect(sanitized).not.toMatch(/vbscript:/i);
    expect(sanitized).not.toMatch(/data:/i);
  });
});
