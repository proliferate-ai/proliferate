import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TurnSeparator } from "./TurnSeparator";

describe("TurnSeparator", () => {
  it("renders a left-aligned disclosure label with a compact chevron", () => {
    const html = renderToStaticMarkup(
      createElement(TurnSeparator, {
        label: "Worked for 1m 5s",
        title: "2 messages, 3 tool calls",
        interactive: true,
        expanded: false,
        onClick: () => {},
      }),
    );

    expect(html).toContain("Worked for 1m 5s");
    expect(html).toContain('title="2 messages, 3 tool calls"');
    expect(html).toContain("justify-start");
    expect(html).toContain("text-[length:var(--text-chat)]");
    expect(html).toContain("size-3.5");
    expect(html).not.toContain("text-xs");
    expect(html).not.toContain("border-t border-current");
  });

  it("renders a noninteractive final separator as an unlabeled quiet rule", () => {
    const html = renderToStaticMarkup(
      createElement(TurnSeparator, { label: "Final message" }),
    );

    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-label="Final message"');
    expect(html).toContain("border-border");
    expect(html).toContain("pt-1");
    expect(html).not.toContain(">Final message<");
    expect(html).not.toContain("<button");
  });
});
