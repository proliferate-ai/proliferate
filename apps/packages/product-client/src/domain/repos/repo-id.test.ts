import { describe, expect, it } from "vitest";

import { canonicalRepoKey, normalizeGitRepoId, parseGitRepoId } from "./repo-id";

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

describe("canonicalRepoKey", () => {
  it("case-folds provider, owner, and repo", () => {
    expect(canonicalRepoKey("GitHub", "Acme", "Rocket")).toBe("github:acme:rocket");
    expect(canonicalRepoKey("github", "acme", "rocket")).toBe("github:acme:rocket");
  });

  it("collapses case variants of the same repository to one key", () => {
    expect(canonicalRepoKey("github", "Acme", "Rocket")).toBe(
      canonicalRepoKey("github", "acme", "rocket"),
    );
  });

  it("strips a single trailing .git suffix (case-insensitive)", () => {
    expect(canonicalRepoKey("github", "acme", "rocket.git")).toBe("github:acme:rocket");
    expect(canonicalRepoKey("github", "acme", "rocket.GIT")).toBe("github:acme:rocket");
    // Only a trailing suffix is stripped, not an interior ".git".
    expect(canonicalRepoKey("github", "acme", "rocket.github.io")).toBe(
      "github:acme:rocket.github.io",
    );
  });

  it("trims surrounding whitespace before folding", () => {
    expect(canonicalRepoKey(" github ", " Acme ", " Rocket.git ")).toBe(
      "github:acme:rocket",
    );
  });
});
