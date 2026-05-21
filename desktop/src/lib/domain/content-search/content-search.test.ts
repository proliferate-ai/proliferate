import { describe, expect, it } from "vitest";
import {
  buildContentSearchLineMatchIds,
  countContentSearchTokenMatches,
  findContentSearchMatches,
  findContentSearchTokenMatchSegments,
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

  it("finds matches that span syntax token boundaries", () => {
    const tokens = [
      { content: "function " },
      { content: "name" },
      { content: "()" },
    ];

    expect(countContentSearchTokenMatches(tokens, "function name")).toBe(1);
    expect(buildContentSearchLineMatchIds({
      idPrefix: "diff:demo:line:8",
      tokens,
      query: "function name",
    })).toEqual(["diff:demo:line:8:0"]);
    expect(findContentSearchTokenMatchSegments(tokens, "function name")).toEqual([
      [{ tokenIndex: 0, start: 0, end: 9, matchIndex: 0 }],
      [{ tokenIndex: 1, start: 0, end: 4, matchIndex: 0 }],
      [],
    ]);
  });
});
