import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanMarkdownBody } from "./PlanMarkdownBody";

describe("PlanMarkdownBody", () => {
  it("surfaces the step count for proposal plan sections", () => {
    const html = renderToStaticMarkup(createElement(PlanMarkdownBody, {
      presentation: "proposal",
      content: [
        "## Context",
        "User requested a test plan.",
        "",
        "## Steps",
        "1. Wake up",
        "2. Coffee",
        "3. Write code",
        "",
        "## Verification",
        "- Confirm display",
      ].join("\n"),
    }));

    expect(html).toContain("Steps · 3");
  });
});
