import type { CloudWorkspaceDetail, CreateCloudWorkspaceRequest } from "@proliferate/cloud-sdk";
import { describe, expect, it } from "vitest";

import { cloudWorkspaceMatchesCreatedBranch } from "./create-workspace-with-transient-recovery";

const request: CreateCloudWorkspaceRequest = {
  gitProvider: "github",
  gitOwner: "proliferate-ai",
  gitRepoName: "proliferate",
  branchName: "codex/otter",
  generatedName: true,
  ownerScope: "personal",
};

describe("create workspace transient recovery", () => {
  it("matches numeric suffixes only for generated branches", () => {
    expect(cloudWorkspaceMatchesCreatedBranch(
      workspace("codex/otter-2"),
      request,
    )).toBe(true);
    expect(cloudWorkspaceMatchesCreatedBranch(
      workspace("codex/otter-2"),
      { ...request, generatedName: false },
    )).toBe(false);
  });

  it("keeps repo identity exact during generated recovery", () => {
    expect(cloudWorkspaceMatchesCreatedBranch(
      workspace("codex/otter-2", { owner: "other" }),
      request,
    )).toBe(false);
    expect(cloudWorkspaceMatchesCreatedBranch(
      workspace("codex/otter-extra"),
      request,
    )).toBe(false);
  });
});

function workspace(
  branch: string,
  overrides: Partial<CloudWorkspaceDetail["repo"]> = {},
): Pick<CloudWorkspaceDetail, "repo"> {
  return {
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: "proliferate",
      branch,
      baseBranch: "main",
      ...overrides,
    },
  };
}
