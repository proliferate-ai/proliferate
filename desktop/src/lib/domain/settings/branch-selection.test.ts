import { describe, expect, it } from "vitest";
import type { GitBranchRef } from "@anyharness/sdk";
import { resolveAutoDetectedBranch } from "./branch-selection";

function branch(overrides: Partial<GitBranchRef> & { name: string }): GitBranchRef {
  return {
    isDefault: false,
    isHead: false,
    isRemote: false,
    upstream: null,
    ...overrides,
  };
}

describe("resolveAutoDetectedBranch", () => {
  it("prefers the local default branch", () => {
    expect(resolveAutoDetectedBranch([
      branch({ name: "main" }),
      branch({ name: "develop", isDefault: true }),
    ])).toBe("develop");
  });

  it("falls back to main and then the first sorted local branch", () => {
    expect(resolveAutoDetectedBranch([
      branch({ name: "feature/a" }),
      branch({ name: "main" }),
    ])).toBe("main");
    expect(resolveAutoDetectedBranch([
      branch({ name: "zebra" }),
      branch({ name: "alpha" }),
    ])).toBe("alpha");
  });

  it("ignores remote branches", () => {
    expect(resolveAutoDetectedBranch([
      branch({ name: "origin/main", isRemote: true, isDefault: true }),
    ])).toBeNull();
  });
});
