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

    expect(tokens[0]).toEqual([{ content: "## Development", color: "#FF678D" }]);
    expect(tokens[2]).toEqual([
      { content: "```", color: "#79797F" },
      { content: "bash", color: "#FBFBFB" },
    ]);
    expect(tokens[3]).toEqual([
      { content: "make test             # Rust workspace tests", color: "#FBFBFB" },
    ]);
    expect(tokens[5]).toEqual([
      { content: "-", color: "#FF678D" },
      { content: " Run ", color: "#FBFBFB" },
      { content: "`", color: "#79797F" },
      { content: "make dev", color: "#5ECC71" },
      { content: "`", color: "#79797F" },
      { content: " now", color: "#FBFBFB" },
    ]);
    expect(tokens[6]).toEqual([
      { content: "See ", color: "#FBFBFB" },
      { content: "[", color: "#79797F" },
      { content: "`", color: "#79797F" },
      { content: "docs/reference/dev-profiles.md", color: "#5ECC71" },
      { content: "`", color: "#79797F" },
      { content: "]", color: "#79797F" },
      { content: "(docs/reference/dev-profiles.md)", color: "#FF678D" },
    ]);
  });
});
