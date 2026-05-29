import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TurnSeparator } from "./TurnSeparator";

describe("TurnSeparator", () => {
  it("keeps interactive history summaries on the same chat font size as final-message separators", () => {
    const html = renderToStaticMarkup(
      createElement(TurnSeparator, {
        label: "2 messages, 3 tool calls",
        interactive: true,
        expanded: false,
        onClick: () => {},
      }),
    );

    expect(html).toContain("2 messages, 3 tool calls");
    expect(html).toContain("text-[length:var(--text-chat)]");
    expect(html).not.toContain("text-xs");
  });
});
