import { describe, expect, it } from "vitest";
import { highlightMarkdownDiffLines } from "./highlighting";

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
        "See [`docs/reference/dev-profiles.md`](docs/reference/dev-profiles.md)",
      ],
      "dark",
    );

    expect(tokens[0]).toEqual([{ content: "## Development", color: "#F67576" }]);
    expect(tokens[2]).toEqual([
      { content: "```", color: "#999999" },
      { content: "bash", color: "#FCFCFC" },
    ]);
    expect(tokens[3]).toEqual([
      { content: "make test             # Rust workspace tests", color: "#FCFCFC" },
    ]);
    expect(tokens[5]).toEqual([
      { content: "-", color: "#F67576" },
      { content: " Run ", color: "#FCFCFC" },
      { content: "`", color: "#999999" },
      { content: "make dev", color: "#85DF7B" },
      { content: "`", color: "#999999" },
      { content: " now", color: "#FCFCFC" },
    ]);
    expect(tokens[6]).toEqual([
      { content: "See ", color: "#FCFCFC" },
      { content: "[", color: "#999999" },
      { content: "`", color: "#999999" },
      { content: "docs/reference/dev-profiles.md", color: "#85DF7B" },
      { content: "`", color: "#999999" },
      { content: "]", color: "#999999" },
      { content: "(docs/reference/dev-profiles.md)", color: "#F67576" },
    ]);
  });
});
