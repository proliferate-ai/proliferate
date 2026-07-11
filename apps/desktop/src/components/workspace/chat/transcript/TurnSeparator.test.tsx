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
    expect(html).toContain("opacity-0");
    expect(html).toContain("group-hover/turn-separator:opacity-100");
    expect(html).toContain("text-current");
    expect(html).not.toContain("flex-1 border-t");
  });

  it("keeps the disclosure chevron visible while expanded", () => {
    const html = renderToStaticMarkup(
      createElement(TurnSeparator, {
        label: "Worked for 8s",
        interactive: true,
        expanded: true,
        onClick: () => {},
      }),
    );

    expect(html).toContain("rotate-90 opacity-100");
  });
});
