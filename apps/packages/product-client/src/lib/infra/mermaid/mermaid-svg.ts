/**
 * Sanitize mermaid SVG with the artifact-runtime SVG profile, then apply the
 * transcript URL policy. The profile is a starting point: tests prove it still
 * keeps mermaid markers/defs/style/path/url(#…) and strips executable nodes.
 */
import DOMPurify from "dompurify";

const BLOCKED_URL = /^(?:javascript|data|vbscript):/i;

export const MERMAID_SVG_PURIFY = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ["script", "foreignObject"] as string[],
};

export function isBlockedDiagramUrl(value: string): boolean {
  return BLOCKED_URL.test(value.trimStart());
}

export function sanitizeMermaidSvg(svg: string): string {
  const clean = DOMPurify.sanitize(svg, MERMAID_SVG_PURIFY);
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    return hideSvgFromAccessibilityTree(stripBlockedUrlsInMarkup(clean));
  }
  const parsed = new DOMParser().parseFromString(clean, "image/svg+xml");
  const root = parsed.documentElement;
  if (!root || root.tagName.toLowerCase() === "parsererror") {
    return hideSvgFromAccessibilityTree(stripBlockedUrlsInMarkup(clean));
  }
  stripBlockedUrls(root);
  if (root.tagName.toLowerCase() === "svg") {
    root.setAttribute("aria-hidden", "true");
    root.setAttribute(
      "class",
      [root.getAttribute("class"), "max-w-full h-auto"].filter(Boolean).join(" "),
    );
  }
  return new XMLSerializer().serializeToString(parsed);
}

function hideSvgFromAccessibilityTree(svg: string): string {
  return svg.replace(/<svg\b/i, '<svg aria-hidden="true"');
}

function stripBlockedUrlsInMarkup(svg: string): string {
  return svg.replace(
    /\s(?:href|xlink:href)=["']([^"']*)["']/gi,
    (full, href: string) => (isBlockedDiagramUrl(href) ? "" : full),
  );
}

function stripBlockedUrls(root: Element): void {
  const hrefNodes = root.querySelectorAll("[href], [xlink\\:href]");
  for (const node of hrefNodes) {
    const href = node.getAttribute("href") ?? node.getAttribute("xlink:href") ?? "";
    if (href && isBlockedDiagramUrl(href)) {
      node.removeAttribute("href");
      node.removeAttribute("xlink:href");
    }
  }
}
