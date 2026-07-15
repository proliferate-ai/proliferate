import { describe, expect, it } from "vitest";
import { highlightMarkdownDiffLines } from "#product/lib/infra/editor/highlighting";

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

    expect(tokens[0]).toEqual([{ content: "## Development", color: "#F22C3D" }]);
    expect(tokens[2]).toEqual([
      { content: "```", color: "#FFFFFF80" },
      { content: "bash", color: "#FFFFFF" },
    ]);
    expect(tokens[3]).toEqual([
      { content: "make test             # Rust workspace tests", color: "#FFFFFF" },
    ]);
    expect(tokens[5]).toEqual([
      { content: "-", color: "#F22C3D" },
      { content: " Run ", color: "#FFFFFF" },
      { content: "`", color: "#FFFFFF80" },
      { content: "make dev", color: "#00A67D" },
      { content: "`", color: "#FFFFFF80" },
      { content: " now", color: "#FFFFFF" },
    ]);
    expect(tokens[6]).toEqual([
      { content: "See ", color: "#FFFFFF" },
      { content: "[", color: "#FFFFFF80" },
      { content: "`", color: "#FFFFFF80" },
      { content: "specs/developing/local/dev-profiles.md", color: "#00A67D" },
      { content: "`", color: "#FFFFFF80" },
      { content: "]", color: "#FFFFFF80" },
      { content: "(specs/developing/local/dev-profiles.md)", color: "#F22C3D" },
    ]);
  });
});
