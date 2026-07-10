import { describe, expect, it } from "vitest";
import {
  buildWorkflowRunDeliveryPayload,
  buildWorkflowWorktreePlan,
  evaluateHeartbeat,
  initialHeartbeatState,
  parseWorkflowRepoPin,
  resolveWorkflowRepoCandidate,
  shouldReattachLocalRun,
  WORKFLOW_LOCAL_DELIVERY_MAX_ATTEMPTS,
  WORKFLOW_LOCAL_EXECUTOR_POST_DELIVERY_GRACE_MS,
  WORKFLOW_LOCAL_HEARTBEAT_MAX_ERRORS,
  workflowDeliveryBackoffMs,
  type WorkflowRepoCandidateLike,
} from "./local-executor";

describe("buildWorkflowRunDeliveryPayload (TRAP guard)", () => {
  it("maps a claim to the runtime plan-delivery wire — plan + workspaceId only", () => {
    const resolvedPlan = { run_id: "r1", steps: [{ kind: "agent.turn" }], gateway: {} };
    const payload = buildWorkflowRunDeliveryPayload({
      resolvedPlan,
      workspaceId: "ws-fresh",
    });
    expect(payload).toEqual({ plan: resolvedPlan, workspaceId: "ws-fresh" });
    // The plan is passed through verbatim (the runtime opens sessions itself under
    // ensure_session forced-bypass — the desktop never resolves a session).
    expect(payload.plan).toBe(resolvedPlan);
  });

  it("carries NO session-creation surface — delivery cannot smuggle a TS-SDK session", () => {
    const payload = buildWorkflowRunDeliveryPayload({
      resolvedPlan: { steps: [] },
      workspaceId: "ws-1",
    });
    // If someone re-routed delivery through the SDK session path, they would need
    // to add prompt/harness/model/session fields here; assert they never appear.
    const keys = Object.keys(payload).sort();
    expect(keys).toEqual(["plan", "workspaceId"]);
    for (const forbidden of [
      "prompt",
      "promptText",
      "harness",
      "agentKind",
      "modelId",
      "modeId",
      "sessionId",
      "reasoningEffort",
    ]) {
      expect(payload).not.toHaveProperty(forbidden);
    }
  });
});

describe("parseWorkflowRepoPin", () => {
  it("parses owner/name into a canonical github identity", () => {
    expect(parseWorkflowRepoPin("Acme/Widgets")).toEqual({
      provider: "github",
      owner: "acme",
      name: "widgets",
    });
  });

  it("rejects a missing or malformed pin", () => {
    expect(parseWorkflowRepoPin(null)).toBeNull();
    expect(parseWorkflowRepoPin("")).toBeNull();
    expect(parseWorkflowRepoPin("no-slash")).toBeNull();
    expect(parseWorkflowRepoPin("too/many/parts")).toBeNull();
    expect(parseWorkflowRepoPin("/leading")).toBeNull();
  });
});

describe("resolveWorkflowRepoCandidate", () => {
  const candidates: WorkflowRepoCandidateLike[] = [
    { identity: { provider: "github", owner: "acme", name: "widgets" } },
    { identity: { provider: "github", owner: "acme", name: "gadgets" } },
  ];

  it("matches the trigger repo pin case-insensitively", () => {
    const match = resolveWorkflowRepoCandidate(candidates, "ACME/Gadgets");
    expect(match?.identity.name).toBe("gadgets");
  });

  it("returns null when no local clone matches", () => {
    expect(resolveWorkflowRepoCandidate(candidates, "acme/unknown")).toBeNull();
    expect(resolveWorkflowRepoCandidate(candidates, null)).toBeNull();
  });
});

describe("buildWorkflowWorktreePlan", () => {
  it("derives a fresh, run-scoped worktree keyed on the run id", () => {
    const plan = buildWorkflowWorktreePlan({
      runId: "11111111-2222-3333-4444-555555555555",
      label: "Nightly digest",
      repoRoot: { id: "root-1", path: "/repos/widgets", remoteRepoName: "widgets" },
      homeDir: "/home/dev",
      defaultBranch: "main",
    });
    expect(plan.repoRootId).toBe("root-1");
    expect(plan.baseRef).toBe("main");
    expect(plan.branchName).toBe("workflow/nightly-digest-1111111122223333");
    expect(plan.workspaceName).toBe("workflow-nightly-digest-1111111122223333");
    expect(plan.targetPath).toBe(
      "/home/dev/.proliferate/worktrees/widgets/workflow-nightly-digest-1111111122223333",
    );
    expect(plan.setupScript).toBeNull();
  });

  it("falls back through repo default branch then representative branch then HEAD", () => {
    const base = {
      runId: "run-1",
      label: "x",
      homeDir: "/h",
    };
    expect(
      buildWorkflowWorktreePlan({
        ...base,
        repoRoot: { id: "r", path: "/p", defaultBranch: "trunk" },
      }).baseRef,
    ).toBe("trunk");
    expect(
      buildWorkflowWorktreePlan({
        ...base,
        repoRoot: { id: "r", path: "/p" },
        representativeBranch: "dev",
      }).baseRef,
    ).toBe("dev");
    expect(
      buildWorkflowWorktreePlan({ ...base, repoRoot: { id: "r", path: "/p" } }).baseRef,
    ).toBe("HEAD");
  });

  it("trims an empty setup script to null", () => {
    const plan = buildWorkflowWorktreePlan({
      runId: "run-1",
      label: "x",
      repoRoot: { id: "r", path: "/p" },
      homeDir: "/h",
      setupScript: "   ",
    });
    expect(plan.setupScript).toBeNull();
  });
});

describe("evaluateHeartbeat (cadence / backoff)", () => {
  it("keeps the claim on an accepted pulse and resets the error streak", () => {
    const after = evaluateHeartbeat({ consecutiveErrors: 1 }, { kind: "ok", accepted: true });
    expect(after.lostClaim).toBe(false);
    expect(after.state.consecutiveErrors).toBe(0);
  });

  it("loses the claim immediately on a rejected pulse", () => {
    const after = evaluateHeartbeat(initialHeartbeatState(), { kind: "ok", accepted: false });
    expect(after.lostClaim).toBe(true);
  });

  it("tolerates a single transient error but loses the claim on the second", () => {
    const first = evaluateHeartbeat(initialHeartbeatState(), { kind: "error" });
    expect(first.lostClaim).toBe(false);
    expect(first.state.consecutiveErrors).toBe(1);
    const second = evaluateHeartbeat(first.state, { kind: "error" });
    expect(second.state.consecutiveErrors).toBe(WORKFLOW_LOCAL_HEARTBEAT_MAX_ERRORS);
    expect(second.lostClaim).toBe(true);
  });
});

describe("shouldReattachLocalRun (re-attach derivation)", () => {
  it("re-attaches a delivered/running/waiting local run that has a workspace", () => {
    for (const status of ["delivered", "running", "waiting_approval"]) {
      expect(
        shouldReattachLocalRun({ targetMode: "local", status, anyharnessWorkspaceId: "ws-1" }),
      ).toBe(true);
    }
  });

  it("does NOT re-attach a still-claimed run (left for the claim poller to reclaim)", () => {
    expect(
      shouldReattachLocalRun({ targetMode: "local", status: "claimed", anyharnessWorkspaceId: null }),
    ).toBe(false);
    expect(
      shouldReattachLocalRun({
        targetMode: "local",
        status: "claimable",
        anyharnessWorkspaceId: null,
      }),
    ).toBe(false);
  });

  it("ignores cloud runs and workspace-less runs", () => {
    expect(
      shouldReattachLocalRun({
        targetMode: "personal_cloud",
        status: "running",
        anyharnessWorkspaceId: "ws-1",
      }),
    ).toBe(false);
    expect(
      shouldReattachLocalRun({ targetMode: "local", status: "running", anyharnessWorkspaceId: null }),
    ).toBe(false);
  });
});

describe("workflowDeliveryBackoffMs (finding 4: bounded delivery retry)", () => {
  it("waits nothing before the first attempt and ~10s/20s before retries", () => {
    // 1-based attempt index: attempt 1 is the initial try (no wait), 2 and 3 back off.
    expect(workflowDeliveryBackoffMs(1)).toBe(0);
    expect(workflowDeliveryBackoffMs(2)).toBe(10_000);
    expect(workflowDeliveryBackoffMs(3)).toBe(20_000);
  });

  it("spans roughly 30s across the bounded attempt cap", () => {
    // Sum of the backoffs BETWEEN the capped attempts (attempts 2..MAX) is ~30s, so
    // a transient runtime hiccup is retried over a real window before failing.
    let total = 0;
    for (let attempt = 2; attempt <= WORKFLOW_LOCAL_DELIVERY_MAX_ATTEMPTS; attempt += 1) {
      total += workflowDeliveryBackoffMs(attempt);
    }
    expect(WORKFLOW_LOCAL_DELIVERY_MAX_ATTEMPTS).toBe(3);
    expect(total).toBe(30_000);
  });
});

describe("post-delivery heartbeat grace (finding 3)", () => {
  it("holds the claim at least one server TTL window past delivery", () => {
    // The server claim TTL is 90s; the grace matches it so a crash between delivery
    // and the relay's first `running` report can't strand a still-`claimed` run.
    expect(WORKFLOW_LOCAL_EXECUTOR_POST_DELIVERY_GRACE_MS).toBe(90_000);
  });
});
