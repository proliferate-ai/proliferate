import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanMarkdownBody } from "./PlanMarkdownBody";

function renderProposal(content: string): string {
  return renderToStaticMarkup(createElement(PlanMarkdownBody, {
    presentation: "proposal",
    content,
  }));
}

describe("PlanMarkdownBody", () => {
  it("surfaces the step count for proposal plan sections", () => {
    const html = renderProposal([
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
    ].join("\n"));

    expect(html).toContain("Steps (3)");
    // "Context" is followed by prose, not an ordered list: no count.
    expect(html).toContain("Context");
    expect(html).not.toContain("Context (");
  });

  it("annotates any heading immediately followed by an ordered list", () => {
    const html = renderProposal([
      "## Implementation",
      "1. Change the schema",
      "2. Backfill",
      "",
      "## Rollout",
      "Some prose first.",
      "1. Not immediate",
    ].join("\n"));

    expect(html).toContain("Implementation (2)");
    // Prose sits between the heading and the list: not "immediately followed".
    expect(html).not.toContain("Rollout (");
  });

  it("does not annotate headings that already carry a count", () => {
    const html = renderProposal([
      "## Steps (3)",
      "1. One",
      "2. Two",
      "3. Three",
    ].join("\n"));

    expect(html).toContain("Steps (3)");
    expect(html).not.toContain("Steps (3) (3)");
  });

  it("leaves fenced code blocks untouched", () => {
    const html = renderProposal([
      "## Steps",
      "1. Run the script below",
      "",
      "```bash",
      "# install",
      "1. not a real step",
      "```",
    ].join("\n"));

    // Only the single real step counts; the fenced "# install" heading and
    // numbered line inside the fence are ignored and unmodified.
    expect(html).toContain("Steps (1)");
    expect(html).toContain("# install");
    expect(html).not.toContain("install (");
  });

  it("renders proposal task lists as checkbox/content grids", () => {
    const html = renderProposal([
      "## Tasks",
      "- [ ] Do **thing** now",
      "- [x] Done item",
    ].join("\n"));

    expect(html).toContain("grid-cols-[auto_minmax(0,1fr)]");
    // Checkbox is nudged and the inline content is wrapped so wrapped lines
    // align in the second grid column.
    expect(html).toMatch(/<input[^>]*class="[^"]*mt-1[^"]*"/);
    expect(html).toContain('<div class="min-w-0">');
  });

  it("restructures loose task items around the leading paragraph checkbox", () => {
    const html = renderProposal([
      "- [ ] First loose item",
      "",
      "  extra paragraph",
      "",
      "- [x] Second loose",
    ].join("\n"));

    // The checkbox is hoisted out of the paragraph into the grid's first
    // column; the paragraph stays in the content wrapper.
    expect(html).toContain("grid-cols-[auto_minmax(0,1fr)]");
    expect(html).not.toMatch(/<p[^>]*>\s*<input/);
    expect(html).toContain("extra paragraph");
  });

  it("keeps default-presentation task lists inline", () => {
    const html = renderToStaticMarkup(createElement(PlanMarkdownBody, {
      content: "- [ ] Inline item",
    }));

    expect(html).not.toContain("grid-cols-[auto_minmax(0,1fr)]");
    expect(html).not.toContain('<div class="min-w-0">');
  });
});
