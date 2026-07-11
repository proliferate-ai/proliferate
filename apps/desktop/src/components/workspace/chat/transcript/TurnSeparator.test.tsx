import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TurnSeparator } from "./TurnSeparator";

describe("TurnSeparator", () => {

  it("renders a left-aligned disclosure without centered side rules", () => {
    const html = renderToStaticMarkup(
      createElement(TurnSeparator, {
        label: "2 messages, 3 tool calls",
        interactive: true,
        expanded: false,
        onClick: () => {},
      }),
    );

    expect(html).toContain("2 messages, 3 tool calls");
    expect(html).toContain("text-chat");
    expect(html).toContain("aria-expanded=\"false\"");
    expect(html).not.toContain("flex-1 border-t");
  });
});
