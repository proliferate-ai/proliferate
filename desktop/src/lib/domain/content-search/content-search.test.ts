import { describe, expect, it } from "vitest";
import {
  buildContentSearchLineMatchIds,
  countContentSearchTokenMatches,
  findContentSearchMatches,
  normalizeContentSearchQuery,
} from "./content-search";

describe("content search domain", () => {
  it("normalizes empty and padded queries", () => {
    expect(normalizeContentSearchQuery("  diff  ")).toBe("diff");
    expect(normalizeContentSearchQuery("   ")).toBe("");
  });

  it("finds non-overlapping case-insensitive matches", () => {
    expect(findContentSearchMatches("Status status STATUS", "status")).toEqual([
      { start: 0, end: 6 },
      { start: 7, end: 13 },
      { start: 14, end: 20 },
    ]);
  });

  it("counts and builds stable line match ids across tokens", () => {
    const tokens = [
      { content: "alpha beta " },
      { content: "BETA gamma beta" },
    ];

    expect(countContentSearchTokenMatches(tokens, "beta")).toBe(3);
    expect(buildContentSearchLineMatchIds({
      idPrefix: "diff:demo:line:4",
      tokens,
      query: "beta",
    })).toEqual([
      "diff:demo:line:4:0",
      "diff:demo:line:4:1",
      "diff:demo:line:4:2",
    ]);
  });
});
