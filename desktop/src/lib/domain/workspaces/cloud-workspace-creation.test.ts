import { afterEach, describe, expect, it, vi } from "vitest";
import { ProliferateClientError } from "@/lib/access/cloud/client";
import {
  buildCloudRepoActionBySourceRoot,
  buildCloudWorkspaceAttemptFromRequest,
  buildConfiguredCloudRepoKeys,
  buildNextCloudWorkspaceAttempt,
  collectTakenCloudWorkspaceSlugs,
  getCloudWorkspaceRepoTarget,
  isCloudWorkspaceBranchConflictError,
  isCreateCloudWorkspaceRequest,
  resolveCloudRepoActionState,
} from "./cloud-workspace-creation";

describe("cloud workspace creation helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds configured repo keys from configured summaries only", () => {
    const keys = buildConfiguredCloudRepoKeys([
      {
        gitOwner: "acme",
        gitRepoName: "rocket",
        configured: true,
        configuredAt: null,
        filesVersion: 1,
      },
      {
        gitOwner: "acme",
        gitRepoName: "draft",
        configured: false,
        configuredAt: null,
        filesVersion: 0,
      },
    ]);

    expect(keys.has("acme::rocket")).toBe(true);
    expect(keys.has("acme::draft")).toBe(false);
  });

  it("resolves loading, configure, and create repo actions", () => {
    expect(resolveCloudRepoActionState({
      repoTarget: null,
      configuredRepoKeys: new Set(),
      isInitialConfigLoad: false,
    })).toEqual({ kind: "hidden", label: null });

    expect(resolveCloudRepoActionState({
      repoTarget: { gitOwner: "acme", gitRepoName: "rocket" },
      configuredRepoKeys: new Set(),
      isInitialConfigLoad: true,
    })).toEqual({ kind: "loading", label: "Loading cloud..." });

    expect(resolveCloudRepoActionState({
      repoTarget: { gitOwner: "acme", gitRepoName: "rocket" },
      configuredRepoKeys: new Set(),
      isInitialConfigLoad: false,
    })).toEqual({ kind: "configure", label: "Configure cloud" });

    expect(resolveCloudRepoActionState({
      repoTarget: { gitOwner: "acme", gitRepoName: "rocket" },
      configuredRepoKeys: new Set(["acme::rocket"]),
      isInitialConfigLoad: false,
    })).toEqual({ kind: "create", label: "New cloud workspace" });
  });

  it("builds cloud action state independently for each repository row", () => {
    const actions = buildCloudRepoActionBySourceRoot({
      repositories: [
        {
          sourceRoot: "/repos/rocket",
          gitOwner: "acme",
          gitRepoName: "rocket",
        },
        {
          sourceRoot: "/repos/draft",
          gitOwner: "acme",
          gitRepoName: "draft",
        },
        {
          sourceRoot: "/repos/local-only",
          gitOwner: null,
          gitRepoName: null,
        },
      ],
      cloudActive: true,
      configuredRepoKeys: new Set(["acme::rocket"]),
      isInitialConfigLoad: false,
    });

    expect(actions["/repos/rocket"]).toEqual({ kind: "create", label: "New cloud workspace" });
    expect(actions["/repos/draft"]).toEqual({ kind: "configure", label: "Configure cloud" });
    expect(actions["/repos/local-only"]).toEqual({ kind: "hidden", label: null });
  });

  it("derives taken slugs from the active branch prefix only", () => {
    const taken = collectTakenCloudWorkspaceSlugs({
      branchPrefixType: "proliferate",
      authUser: null,
      knownBranchNames: new Set(["proliferate/abalone", "other/acacia", "release"]),
      triedBranchNames: new Set(["proliferate/agate"]),
    });

    expect(taken).toEqual(new Set(["abalone", "agate"]));
  });

  it("builds the next cloud create attempt from a fresh branch candidate", () => {
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((typedArray) => {
      (typedArray as Uint32Array)[0] = 0;
      return typedArray;
    });

    const attempt = buildNextCloudWorkspaceAttempt({
      target: { gitOwner: "acme", gitRepoName: "rocket" },
      branchPrefixType: "proliferate",
      authUser: null,
      knownBranchNames: new Set(["proliferate/abalone"]),
      triedBranchNames: new Set<string>(),
    });

    expect(attempt.branchName).toMatch(/^proliferate\/[a-z-]+$/);
    expect(attempt.branchName).not.toBe("proliferate/abalone");
    expect(attempt.request).toEqual({
      gitProvider: "github",
      gitOwner: "acme",
      gitRepoName: "rocket",
      baseBranch: undefined,
      branchName: attempt.branchName,
      displayName: null,
      ownerScope: "personal",
    });
    expect(attempt.triedBranchNames).toEqual(new Set([attempt.branchName]));
  });

  it("passes the selected base branch while keeping generated branch naming", () => {
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((typedArray) => {
      (typedArray as Uint32Array)[0] = 0;
      return typedArray;
    });

    const attempt = buildNextCloudWorkspaceAttempt({
      target: {
        gitOwner: "acme",
        gitRepoName: "rocket",
        baseBranch: "release",
      },
      branchPrefixType: "proliferate",
      authUser: null,
      knownBranchNames: new Set(),
      triedBranchNames: new Set<string>(),
    });

    expect(attempt.branchName).not.toBe("release");
    expect(attempt.request.baseBranch).toBe("release");
    expect(attempt.request.branchName).toBe(attempt.branchName);
  });

  it("reuses an explicit cloud request without generating a new branch", () => {
    const request = {
      gitProvider: "github" as const,
      gitOwner: "acme",
      gitRepoName: "rocket",
      branchName: "proliferate/acacia",
      displayName: null,
      ownerScope: "personal" as const,
    };

    expect(isCreateCloudWorkspaceRequest(request)).toBe(true);
    expect(getCloudWorkspaceRepoTarget(request)).toEqual({
      gitOwner: "acme",
      gitRepoName: "rocket",
    });
    expect(buildCloudWorkspaceAttemptFromRequest(request)).toEqual({
      branchName: "proliferate/acacia",
      request,
      triedBranchNames: new Set(["proliferate/acacia"]),
    });
  });

  it("recognizes server-reported branch conflicts", () => {
    expect(isCloudWorkspaceBranchConflictError(
      new ProliferateClientError("exists", 400, "github_branch_already_exists"),
    )).toBe(true);
    expect(isCloudWorkspaceBranchConflictError(
      new ProliferateClientError("exists", 400, "cloud_branch_already_exists"),
    )).toBe(true);
    expect(isCloudWorkspaceBranchConflictError(
      new ProliferateClientError("bad", 400, "github_branch_not_found"),
    )).toBe(false);
  });
});
