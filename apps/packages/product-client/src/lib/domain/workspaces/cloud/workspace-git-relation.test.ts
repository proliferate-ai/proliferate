import { describe, expect, it } from "vitest";
import {
  classifyWorkspaceGitSide,
  deriveWorkspaceGitRelation,
  type WorkspaceGitSide,
} from "#product/lib/domain/workspaces/cloud/workspace-git-relation";

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

function side(overrides: Partial<WorkspaceGitSide> = {}): WorkspaceGitSide {
  return {
    presence: "present",
    provider: "github",
    owner: "acme",
    repoName: "rocket",
    branch: "feat/x",
    headSha: HEAD_A,
    clean: true,
    conflicted: false,
    detached: false,
    operationInProgress: false,
    ahead: 0,
    behind: 0,
    hasUpstream: true,
    ...overrides,
  };
}

function relation(local: Partial<WorkspaceGitSide>, cloud: Partial<WorkspaceGitSide> = {}) {
  return deriveWorkspaceGitRelation({ local: side(local), cloud: side(cloud) });
}

describe("classifyWorkspaceGitSide", () => {
  it("orders blocking states: conflict > operation > detached > dirty", () => {
    expect(classifyWorkspaceGitSide(side({ conflicted: true, clean: false })).kind).toBe("conflicted");
    expect(classifyWorkspaceGitSide(side({ operationInProgress: true, clean: false })).kind).toBe("operation");
    expect(classifyWorkspaceGitSide(side({ detached: true, branch: null, clean: false })).kind).toBe("detached");
    expect(classifyWorkspaceGitSide(side({ clean: false })).kind).toBe("dirty");
  });

  it("classifies unknown when clean/conflicted are unavailable", () => {
    expect(classifyWorkspaceGitSide(side({ clean: null })).kind).toBe("unknown");
    expect(classifyWorkspaceGitSide(side({ conflicted: null })).kind).toBe("unknown");
  });

  it("classifies presence first", () => {
    expect(classifyWorkspaceGitSide(side({ presence: "missing" })).kind).toBe("missing");
    expect(classifyWorkspaceGitSide(side({ presence: "unreachable" })).kind).toBe("unreachable");
  });

  it("classifies unpublished / ahead / behind / diverged / clean", () => {
    expect(classifyWorkspaceGitSide(side({ hasUpstream: false })).kind).toBe("unpublished");
    expect(classifyWorkspaceGitSide(side({ ahead: 2 })).kind).toBe("ahead");
    expect(classifyWorkspaceGitSide(side({ behind: 3 })).kind).toBe("behind");
    expect(classifyWorkspaceGitSide(side({ ahead: 1, behind: 1 })).kind).toBe("diverged");
    expect(classifyWorkspaceGitSide(side()).kind).toBe("clean");
  });
});

describe("deriveWorkspaceGitRelation — exhaustive matrix", () => {
  it("same_head: equal clean heads on the same branch", () => {
    expect(relation({}, {})).toEqual({ kind: "same_head", headSha: HEAD_A });
  });

  it("differing exact heads are NEVER same_head (diverged when clean)", () => {
    const r = relation({ headSha: HEAD_A }, { headSha: HEAD_B });
    expect(r.kind).toBe("diverged");
    expect(r).toMatchObject({ localHead: HEAD_A, cloudHead: HEAD_B, remoteHead: null });
  });

  it("local_ahead: local ahead of tracking, cloud clean; remoteHead is null (not client-verifiable)", () => {
    const r = relation({ ahead: 2, headSha: HEAD_A }, { headSha: HEAD_B });
    expect(r).toEqual({ kind: "local_ahead", localHead: HEAD_A, remoteHead: null, commits: 2 });
  });

  it("cloud_ahead: cloud ahead, local clean", () => {
    const r = relation({ headSha: HEAD_A }, { ahead: 3, headSha: HEAD_B });
    expect(r).toEqual({ kind: "cloud_ahead", cloudHead: HEAD_B, remoteHead: null, commits: 3 });
  });

  it("local_dirty / cloud_dirty block before head comparison", () => {
    expect(relation({ clean: false }).kind).toBe("local_dirty");
    expect(relation({}, { clean: false }).kind).toBe("cloud_dirty");
  });

  it("conflicted / operation / detached carry the target", () => {
    expect(relation({ conflicted: true })).toMatchObject({ kind: "conflicted", target: "local" });
    expect(relation({}, { operationInProgress: true })).toMatchObject({
      kind: "git_operation_in_progress",
      target: "cloud",
    });
    expect(relation({ detached: true, branch: null })).toMatchObject({ kind: "detached", target: "local" });
  });

  it("behind: one side clean-behind at a different head, other clean", () => {
    // Equal heads are same_head regardless of tracking-ref counts; `behind`
    // fires only when the heads actually differ.
    expect(relation({ behind: 1, headSha: HEAD_B }, { headSha: HEAD_A }))
      .toMatchObject({ kind: "behind", target: "local" });
    expect(relation({ headSha: HEAD_A }, { behind: 1, headSha: HEAD_B }))
      .toMatchObject({ kind: "behind", target: "cloud" });
  });

  it("diverged: both diverged, or clean-but-different heads, or case-different branch", () => {
    expect(relation({ ahead: 1, behind: 1, headSha: HEAD_A }, { headSha: HEAD_B }).kind).toBe("diverged");
    expect(relation({ branch: "feat/X", headSha: HEAD_A }, { branch: "feat/x", headSha: HEAD_A }).kind)
      .toBe("diverged");
  });

  it("missing / unreachable surface first with the target", () => {
    expect(relation({ presence: "missing" })).toEqual({ kind: "missing", target: "local" });
    expect(relation({}, { presence: "missing" })).toEqual({ kind: "missing", target: "cloud" });
    expect(relation({ presence: "unreachable" })).toEqual({ kind: "unreachable", target: "local" });
    expect(relation({}, { presence: "unreachable" })).toEqual({ kind: "unreachable", target: "cloud" });
  });

  it("unreachable beats missing when local is unreachable and cloud missing", () => {
    expect(relation({ presence: "unreachable" }, { presence: "missing" }))
      .toEqual({ kind: "unreachable", target: "local" });
  });

  it("different repositories are unknown, never compared", () => {
    const r = relation({ repoName: "rocket" }, { repoName: "other" });
    expect(r).toMatchObject({ kind: "unknown" });
  });

  it("unknown when status unavailable on a side", () => {
    expect(relation({ clean: null }).kind).toBe("unknown");
  });

  it("unknown when heads differ but a head sha is unknown (never guesses)", () => {
    expect(relation({ ahead: 1, headSha: null }, { headSha: HEAD_B }).kind).toBe("unknown");
  });

  it("local dirty takes precedence over cloud conflicted (local-first severity)", () => {
    expect(relation({ clean: false }, { conflicted: true }).kind).toBe("local_dirty");
  });

  // PR6-CLOUD-TRUTH-01: a Cloud side whose live status is UNKNOWN must never be
  // called same_head or safe, even when the last-reported head matches locally.
  it("does NOT claim same_head when the cloud side's live state is unknown (unproven)", () => {
    // Cloud presence "present" with null cleanliness = last-reported head, no
    // live proof (the real shape produced by cloudGitSideLastReported).
    const r = relation(
      { headSha: HEAD_A },
      { headSha: HEAD_A, clean: null, conflicted: null },
    );
    expect(r.kind).not.toBe("same_head");
    expect(r.kind).toBe("cloud_state_unverified");
    expect(r).toMatchObject({ cloudLastReportedHead: HEAD_A, localHead: HEAD_A });
  });

  it("does NOT claim safe when the cloud checkout CHANGED after materialization (unknown clean)", () => {
    // Cloud head still reads last-reported HEAD_A but live clean/conflict are
    // unknown (couldn't read): the resolver withholds any safety verdict.
    const cloudUnknownClean = side({ headSha: HEAD_A, clean: null, conflicted: null });
    const r = deriveWorkspaceGitRelation({ local: side({ headSha: HEAD_A }), cloud: cloudUnknownClean });
    expect(r.kind).toBe("cloud_state_unverified");
  });

  it("DOES claim same_head only when BOTH sides are proven clean at the exact head", () => {
    const r = relation({ headSha: HEAD_A }, { headSha: HEAD_A }); // both live-clean
    expect(r).toEqual({ kind: "same_head", headSha: HEAD_A });
  });

  it("no_cloud_copy for a local-only workspace (absent cloud), never 'Cloud missing'", () => {
    const r = deriveWorkspaceGitRelation({
      local: side(),
      cloud: side({ presence: "absent" }),
    });
    expect(r.kind).toBe("no_cloud_copy");
  });

  it("no_local_copy when the local side is absent", () => {
    const r = deriveWorkspaceGitRelation({
      local: side({ presence: "absent" }),
      cloud: side(),
    });
    expect(r.kind).toBe("no_local_copy");
  });

  it("surfaces a hard LOCAL blocker before cloud_state_unverified (honest regardless)", () => {
    const r = deriveWorkspaceGitRelation({
      local: side({ clean: false }),
      cloud: side({ headSha: HEAD_A, clean: null, conflicted: null }),
    });
    expect(r.kind).toBe("local_dirty");
  });
});
