// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { findAnnotationRanges } from "#product/hooks/chat/ui/selected-response-annotation-anchors";

afterEach(() => {
  document.body.innerHTML = "";
});

function mountProse(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `<div data-assistant-prose>${html}</div>`;
  document.body.append(root);
  return root;
}

describe("findAnnotationRanges", () => {
  it("re-locates an excerpt that spans formatting boundaries", () => {
    const root = mountProse("<p>Restarted <b>OpenCode</b> to reload the config.</p>");

    const [range] = findAnnotationRanges(root, ["Restarted OpenCode to reload"]);

    expect(range?.toString()).toBe("Restarted OpenCode to reload");
  });

  it("normalizes whitespace differences between selection text and the DOM", () => {
    const root = mountProse("<p>alpha\n  beta</p>");

    const [range] = findAnnotationRanges(root, ["alpha beta"]);

    expect(range?.toString().replace(/\s+/gu, " ")).toBe("alpha beta");
  });

  it("claims distinct occurrences for identical excerpts in annotation order", () => {
    const root = mountProse("<p>same words here and same words there</p>");

    const [first, second, third] = findAnnotationRanges(root, [
      "same words",
      "same words",
      "same words",
    ]);

    expect(first?.toString()).toBe("same words");
    expect(second?.toString()).toBe("same words");
    expect(first?.startOffset).not.toBe(second?.startOffset);
    // Only two occurrences exist; the third annotation has no anchor.
    expect(third).toBeNull();
  });

  it("returns null when the excerpt is no longer in the transcript", () => {
    const root = mountProse("<p>completely different content</p>");

    const [range] = findAnnotationRanges(root, ["vanished excerpt"]);

    expect(range).toBeNull();
  });
});
