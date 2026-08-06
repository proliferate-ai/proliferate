import { describe, expect, it } from "vitest";
import { PROLIFERATE_DARK_THEME } from "#product/lib/infra/editor/code-theme-tokens";
import { highlightMarkdownDiffLines } from "#product/lib/infra/editor/highlighting";

// Expected colors come from the generated palette, not repeated hex literals:
// the design token authority owns these values, and this test asserts which
// semantic role each Markdown construct resolves to.
const colors = PROLIFERATE_DARK_THEME.palette;

describe("highlightMarkdownDiffLines", () => {
  it("keeps fenced Markdown code plain while highlighting Markdown syntax", () => {
    const tokens = highlightMarkdownDiffLines(
      [
        "## Development",
        "",
        "```bash",
        "make test             # Rust workspace tests",
        "```",
        "- Run `make dev` now",
        "See [`specs/developing/local/dev-profiles.md`](specs/developing/local/dev-profiles.md)",
      ],
      "dark",
    );

    expect(tokens[0]).toEqual([{ content: "## Development", color: colors.heading }]);
    expect(tokens[2]).toEqual([
      { content: "```", color: colors.muted },
      { content: "bash", color: colors.foreground },
    ]);
    expect(tokens[3]).toEqual([
      { content: "make test             # Rust workspace tests", color: colors.foreground },
    ]);
    expect(tokens[5]).toEqual([
      { content: "-", color: colors.heading },
      { content: " Run ", color: colors.foreground },
      { content: "`", color: colors.muted },
      { content: "make dev", color: colors.string },
      { content: "`", color: colors.muted },
      { content: " now", color: colors.foreground },
    ]);
    expect(tokens[6]).toEqual([
      { content: "See ", color: colors.foreground },
      { content: "[", color: colors.muted },
      { content: "`", color: colors.muted },
      { content: "specs/developing/local/dev-profiles.md", color: colors.string },
      { content: "`", color: colors.muted },
      { content: "]", color: colors.muted },
      { content: "(specs/developing/local/dev-profiles.md)", color: colors.heading },
    ]);
  });
});
