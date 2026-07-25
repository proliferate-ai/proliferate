import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CodeBlock } from "./CodeBlock";

describe("CodeBlock", () => {
  it("uses transcript code tokens with legacy fallbacks", () => {
    const html = renderToStaticMarkup(<CodeBlock code="const value = 1;" label="ts" />);

    expect(html).toContain("var(--text-chat-code,var(--text-chat))");
    expect(html).toContain("var(--text-chat-code--line-height,1.5)");
  });
});
