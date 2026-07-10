import { describe, expect, it } from "vitest";

import {
  annotateIntegrationReadiness,
  buildStartRunBody,
  deriveLastUsedTarget,
  isBindableSessionCandidate,
  isExistingSessionChoice,
  latestRunMsByWorkflow,
  orderRecommendedWorkflows,
  readinessChipLabel,
  recallTarget,
  rememberTarget,
  resolveChatOriginTarget,
  withCurrentSessionCandidate,
  type LastUsedTargetMemory,
  type RecommendedWorkflowInput,
  type WorkflowRunRecency,
  type WorkflowRunTargetRecord,
  type WorkflowSessionCandidateInput,
} from "./run-launch";

describe("buildStartRunBody (R2/R3 launch payload)", () => {
  it("fresh by default — omits sessionBindings when every slot is fresh", () => {
    const body = buildStartRunBody({
      inputs: { repo: "checkout-web", max_issues: 25 },
      targetMode: "local",
      sessionBindings: [
        { slot: "triage", sessionId: null },
        { slot: "fix", sessionId: "new" },
      ],
    });
    expect(body).toEqual({
      inputs: { repo: "checkout-web", max_issues: 25 },
      targetMode: "local",
      target: {},
    });
    expect(body.sessionBindings).toBeUndefined();
  });

  it("bind-existing — emits only the slots bound to a real session id", () => {
    const body = buildStartRunBody({
      inputs: {},
      targetMode: "personal_cloud",
      cloudWorkspaceId: "ws_cloud_1",
      sessionBindings: [
        { slot: "triage", sessionId: "sess_a3" },
        { slot: "fix", sessionId: "new" },
        { slot: "review", sessionId: null },
      ],
    });
    expect(body.target).toEqual({ workspaceId: "ws_cloud_1" });
    expect(body.sessionBindings).toEqual({ triage: "sess_a3" });
  });

  it("only carries the cloud workspace on the wire for personal_cloud runs", () => {
    const local = buildStartRunBody({
      inputs: {},
      targetMode: "local",
      cloudWorkspaceId: "ws_cloud_1",
    });
    expect(local.target).toEqual({});

    const cloud = buildStartRunBody({
      inputs: {},
      targetMode: "personal_cloud",
      cloudWorkspaceId: "ws_cloud_1",
    });
    expect(cloud.target).toEqual({ workspaceId: "ws_cloud_1" });
  });

  it("passes versionId through only when set", () => {
    expect(buildStartRunBody({ inputs: {}, targetMode: "local" }).versionId).toBeUndefined();
    expect(
      buildStartRunBody({ inputs: {}, targetMode: "local", versionId: "v_2" }).versionId,
    ).toBe("v_2");
  });

  it("isExistingSessionChoice treats null/new as fresh", () => {
    expect(isExistingSessionChoice(null)).toBe(false);
    expect(isExistingSessionChoice("new")).toBe(false);
    expect(isExistingSessionChoice("")).toBe(false);
    expect(isExistingSessionChoice("sess_1")).toBe(true);
  });
});

describe("last-used target memory (R6 round-trip)", () => {
  it("remember then recall returns the stored target", () => {
    let memory: LastUsedTargetMemory = {};
    memory = rememberTarget(memory, "wf_1", { targetMode: "personal_cloud", workspaceId: "ws_1" });
    expect(recallTarget(memory, "wf_1")).toEqual({
      targetMode: "personal_cloud",
      workspaceId: "ws_1",
    });
    expect(recallTarget(memory, "wf_unknown")).toBeNull();
  });

  it("is immutable and last-write-wins per workflow", () => {
    const original: LastUsedTargetMemory = {};
    const first = rememberTarget(original, "wf_1", { targetMode: "local", workspaceId: "ws_local" });
    const second = rememberTarget(first, "wf_1", {
      targetMode: "personal_cloud",
      workspaceId: "ws_cloud",
    });
    expect(original).toEqual({}); // untouched
    expect(recallTarget(first, "wf_1")).toEqual({ targetMode: "local", workspaceId: "ws_local" });
    expect(recallTarget(second, "wf_1")).toEqual({
      targetMode: "personal_cloud",
      workspaceId: "ws_cloud",
    });
  });

  it("derives the last-used target from the most recent run row", () => {
    const runs: WorkflowRunTargetRecord[] = [
      { workflowId: "wf_1", createdAt: "2026-07-01T00:00:00Z", targetMode: "local", workspaceId: "ws_old" },
      { workflowId: "wf_1", createdAt: "2026-07-08T00:00:00Z", targetMode: "personal_cloud", workspaceId: "ws_new" },
      { workflowId: "wf_2", createdAt: "2026-07-09T00:00:00Z", targetMode: "local", workspaceId: "ws_other" },
      { workflowId: "wf_1", createdAt: null, targetMode: "local", workspaceId: "ws_null" },
    ];
    expect(deriveLastUsedTarget(runs, "wf_1")).toEqual({
      targetMode: "personal_cloud",
      workspaceId: "ws_new",
    });
    expect(deriveLastUsedTarget(runs, "wf_never")).toBeNull();
  });
});

describe("orderRecommendedWorkflows (R5 strip)", () => {
  const workflows: RecommendedWorkflowInput[] = [
    { id: "wf_seed", name: "Seed (never run)", integrations: ["slack"] },
    { id: "wf_old", name: "Ran a while ago" },
    { id: "wf_recent", name: "Ran most recently" },
    { id: "wf_seed2", name: "Another seed" },
  ];
  const runs: WorkflowRunRecency[] = [
    { workflowId: "wf_old", createdAt: "2026-07-01T00:00:00Z" },
    { workflowId: "wf_recent", createdAt: "2026-07-08T12:00:00Z" },
    { workflowId: "wf_recent", createdAt: "2026-07-02T00:00:00Z" },
    { workflowId: "wf_unlisted", createdAt: "2026-07-09T00:00:00Z" },
  ];

  it("orders most-recently-run first and retains never-run seeds at the tail", () => {
    const ordered = orderRecommendedWorkflows(workflows, runs);
    expect(ordered.map((w) => w.id)).toEqual(["wf_recent", "wf_old", "wf_seed", "wf_seed2"]);
    // Seeds with no runs are still present (not filtered out).
    expect(ordered.find((w) => w.id === "wf_seed")).toBeTruthy();
  });

  it("uses each workflow's latest run for recency", () => {
    const latest = latestRunMsByWorkflow(runs);
    expect(latest.get("wf_recent")).toBe(Date.parse("2026-07-08T12:00:00Z"));
  });

  it("keeps never-run entries in incoming order and honors the limit", () => {
    const ordered = orderRecommendedWorkflows(workflows, [], { limit: 2 });
    expect(ordered.map((w) => w.id)).toEqual(["wf_seed", "wf_old"]);
  });

  it("annotates integration readiness against connected providers", () => {
    const ordered = orderRecommendedWorkflows(workflows, runs, {
      connectedProviders: ["issues"],
    });
    const seed = ordered.find((w) => w.id === "wf_seed");
    expect(seed?.readiness).toEqual({ ready: false, missing: ["slack"] });
    const old = ordered.find((w) => w.id === "wf_old");
    expect(old?.readiness).toEqual({ ready: true, missing: [] });
  });
});

describe("annotateIntegrationReadiness", () => {
  it("reports missing namespaces and readiness", () => {
    expect(annotateIntegrationReadiness(["slack", "issues"], ["issues"])).toEqual({
      ready: false,
      missing: ["slack"],
    });
    expect(annotateIntegrationReadiness([], [])).toEqual({ ready: true, missing: [] });
    expect(annotateIntegrationReadiness(["slack"], ["slack", "issues"])).toEqual({
      ready: true,
      missing: [],
    });
  });
});

describe("readinessChipLabel (strip readiness chip presentation)", () => {
  it("is null when ready, and a quiet label when not", () => {
    expect(readinessChipLabel({ ready: true, missing: [] })).toBeNull();
    expect(readinessChipLabel({ ready: false, missing: ["slack"] })).toBe("Needs setup");
  });
});

describe("resolveChatOriginTarget (composer door target derivation)", () => {
  it("the chat's own workspace wins over a remembered last-used target", () => {
    const chatOrigin = { targetMode: "local" as const, workspaceId: "ws_chat" };
    const lastUsed = { targetMode: "personal_cloud" as const, workspaceId: "ws_cloud_old" };
    expect(resolveChatOriginTarget(chatOrigin, lastUsed)).toEqual(chatOrigin);
  });

  it("falls back to last-used when there is no chat origin (workflows-tab/new-chat doors)", () => {
    const lastUsed = { targetMode: "personal_cloud" as const, workspaceId: "ws_cloud_old" };
    expect(resolveChatOriginTarget(null, lastUsed)).toEqual(lastUsed);
  });

  it("is null when neither is available (first run ever, no chat origin)", () => {
    expect(resolveChatOriginTarget(null, null)).toBeNull();
  });
});

describe("withCurrentSessionCandidate (current-session-candidate inclusion)", () => {
  const others: WorkflowSessionCandidateInput[] = [
    { id: "sess_other", title: "Fix flaky test", harness: "claude", workspaceId: "ws_1" },
  ];

  it("prepends the current session ahead of other candidates", () => {
    const merged = withCurrentSessionCandidate(others, {
      sessionId: "sess_current",
      title: "This session",
      harness: "claude",
      workspaceId: "ws_1",
    });
    expect(merged.map((c) => c.id)).toEqual(["sess_current", "sess_other"]);
  });

  it("de-dupes when the current session is already present, keeping it first", () => {
    const withDuplicate: WorkflowSessionCandidateInput[] = [
      { id: "sess_current", title: "Stale title", harness: "claude", workspaceId: "ws_1" },
      ...others,
    ];
    const merged = withCurrentSessionCandidate(withDuplicate, {
      sessionId: "sess_current",
      title: "This session",
      harness: "claude",
      workspaceId: "ws_1",
    });
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({
      id: "sess_current",
      title: "This session",
      harness: "claude",
      workspaceId: "ws_1",
    });
  });

  it("returns candidates unchanged when there is no chat origin", () => {
    expect(withCurrentSessionCandidate(others, null)).toEqual(others);
  });
});

describe("isBindableSessionCandidate (candidate filtering rule, B8/L29)", () => {
  const slot = { harness: "claude", workspaceKey: "ws_1" };

  it("accepts a same-harness candidate on the target workspace", () => {
    expect(isBindableSessionCandidate({ harness: "claude", workspaceId: "ws_1" }, slot)).toBe(true);
  });

  it("rejects a harness mismatch", () => {
    expect(isBindableSessionCandidate({ harness: "codex", workspaceId: "ws_1" }, slot)).toBe(false);
  });

  it("rejects a session on a different workspace", () => {
    expect(isBindableSessionCandidate({ harness: "claude", workspaceId: "ws_2" }, slot)).toBe(false);
  });

  it("rejects everything when the slot has no resolved target workspace", () => {
    expect(
      isBindableSessionCandidate({ harness: "claude", workspaceId: "ws_1" }, { harness: "claude", workspaceKey: null }),
    ).toBe(false);
  });
});
