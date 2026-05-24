import { describe, expect, it } from "vitest";

import { normalizeGitRepoId, parseGitRepoId } from "./repo-id";

describe("parseGitRepoId", () => {
  it("parses owner/name repo ids", () => {
    expect(parseGitRepoId("proliferate-ai/proliferate")).toEqual({
      gitOwner: "proliferate-ai",
      gitRepoName: "proliferate",
    });
  });

  it("parses GitHub URLs and ssh remotes", () => {
    expect(normalizeGitRepoId("https://github.com/proliferate-ai/proliferate.git")).toBe(
      "proliferate-ai/proliferate",
    );
    expect(normalizeGitRepoId("git@github.com:proliferate-ai/proliferate.git")).toBe(
      "proliferate-ai/proliferate",
    );
  });

  it("rejects unsupported or ambiguous values", () => {
    expect(parseGitRepoId("https://example.com/proliferate-ai/proliferate")).toBeNull();
    expect(parseGitRepoId("proliferate-ai/proliferate/extra")).toBeNull();
    expect(parseGitRepoId("missing-owner")).toBeNull();
  });
});
