import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const AUTHENTICATED_CSS = readFileSync(
  new URL("./authenticated.css", import.meta.url),
  "utf8",
);
const EAGER_PRODUCT_CSS = readFileSync(
  new URL("../../../design/src/css/product.css", import.meta.url),
  "utf8",
);

describe("authenticated Markdown CSS ownership", () => {
  it("keeps the semantic presentation contract behind the authenticated boundary", () => {
    expect(AUTHENTICATED_CSS).toContain(".chat-markdown {");
    expect(AUTHENTICATED_CSS).toContain("font-size: var(--markdown-font-size)");
    expect(AUTHENTICATED_CSS).toContain(":where(.chat-markdown) :where(h1)");
    expect(AUTHENTICATED_CSS).not.toContain(".chat-markdown h1");
    expect(AUTHENTICATED_CSS).toContain('[data-markdown-code-content="true"]');
    expect(EAGER_PRODUCT_CSS).not.toContain(".chat-markdown");
  });
});
