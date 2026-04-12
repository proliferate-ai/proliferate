import { afterEach, describe, expect, it, vi } from "vitest";
import { ProliferateClientError } from "@/lib/integrations/cloud/client";
import {
  buildConfiguredCloudRepoKeys,
  buildNextCloudWorkspaceAttempt,
  collectTakenCloudWorkspaceSlugs,
  isCloudWorkspaceBranchConflictError,
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
      branchName: attempt.branchName,
      displayName: null,
    });
    expect(attempt.triedBranchNames).toEqual(new Set([attempt.branchName]));
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
