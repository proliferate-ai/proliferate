import { describe, expect, it } from "vitest";
import {
  type LinkCloudTargetProof,
  type LinkLocalCandidateProof,
  verifyLinkCandidate,
} from "#product/lib/domain/workspaces/cloud/link-copies-verification";

const HEAD = "a".repeat(40);

function candidate(overrides: Partial<LinkLocalCandidateProof> = {}): LinkLocalCandidateProof {
  return {
    anyharnessWorkspaceId: "ws-1",
    provider: "github",
    owner: "acme",
    repoName: "rocket",
    branch: "feat/x",
    headSha: HEAD,
    clean: true,
    conflicted: false,
    detached: false,
    operationInProgress: false,
    alreadyLinkedCloudWorkspaceId: null,
    ...overrides,
  };
}

function target(overrides: Partial<LinkCloudTargetProof> = {}): LinkCloudTargetProof {
  return {
    cloudWorkspaceId: "cloud-1",
    provider: "github",
    owner: "acme",
    repoName: "rocket",
    branch: "feat/x",
    headSha: HEAD,
    ...overrides,
  };
}

describe("verifyLinkCandidate", () => {
  it("links a clean, same-repo, same-branch, exact-HEAD candidate", () => {
    expect(verifyLinkCandidate(candidate(), target())).toEqual({ linkable: true });
  });

  it("rejects a different repository (canonical mismatch)", () => {
    const result = verifyLinkCandidate(candidate({ repoName: "other" }), target());
    expect(result).toMatchObject({ linkable: false });
  });

  it("treats provider/owner/repo case-insensitively (canonical repo key)", () => {
    // canonicalRepoKey case-folds identity, so a case-different repo still matches.
    expect(
      verifyLinkCandidate(candidate({ owner: "ACME", repoName: "Rocket" }), target()),
    ).toEqual({ linkable: true });
  });

  it("rejects a case-DIFFERENT branch (refs are case-sensitive)", () => {
    const result = verifyLinkCandidate(candidate({ branch: "feat/X" }), target({ branch: "feat/x" }));
    expect(result).toMatchObject({ linkable: false });
    expect((result as { blocker: string }).blocker).toMatch(/different branch/);
  });

  it("rejects a DIFFERENT commit (no fall-through to materialization)", () => {
    const result = verifyLinkCandidate(candidate({ headSha: "b".repeat(40) }), target());
    expect(result).toMatchObject({ linkable: false });
    expect((result as { blocker: string }).blocker).toMatch(/different commit/);
  });

  it("rejects dirty / conflicted / detached / mid-operation candidates", () => {
    expect(verifyLinkCandidate(candidate({ clean: false }), target())).toMatchObject({ linkable: false });
    expect(verifyLinkCandidate(candidate({ conflicted: true }), target())).toMatchObject({ linkable: false });
    expect(verifyLinkCandidate(candidate({ detached: true, branch: null }), target())).toMatchObject({ linkable: false });
    expect(verifyLinkCandidate(candidate({ operationInProgress: true }), target())).toMatchObject({ linkable: false });
  });

  it("rejects a candidate already linked to a DIFFERENT active Cloud workspace", () => {
    const result = verifyLinkCandidate(
      candidate({ alreadyLinkedCloudWorkspaceId: "cloud-other" }),
      target({ cloudWorkspaceId: "cloud-1" }),
    );
    expect(result).toMatchObject({ linkable: false });
  });

  it("allows a candidate already linked to THIS Cloud workspace (idempotent)", () => {
    expect(
      verifyLinkCandidate(
        candidate({ alreadyLinkedCloudWorkspaceId: "cloud-1" }),
        target({ cloudWorkspaceId: "cloud-1" }),
      ),
    ).toEqual({ linkable: true });
  });

  it("rejects when either HEAD is unknown", () => {
    expect(verifyLinkCandidate(candidate({ headSha: null }), target())).toMatchObject({ linkable: false });
    expect(verifyLinkCandidate(candidate(), target({ headSha: null }))).toMatchObject({ linkable: false });
  });
});
