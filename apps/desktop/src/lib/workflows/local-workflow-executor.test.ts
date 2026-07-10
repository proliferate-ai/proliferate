import { describe, expect, it, vi } from "vitest";
import {
  executeLocalWorkflowRun,
  LocalWorkflowExecutorError,
  type WorkflowExecutorDeps,
} from "./local-workflow-executor";
import {
  WORKFLOW_LOCAL_DELIVERY_MAX_ATTEMPTS,
  type WorkflowWorktreePlan,
} from "@/lib/domain/workflows/local-executor";

function plan(overrides: Partial<WorkflowWorktreePlan> = {}): WorkflowWorktreePlan {
  return {
    repoRootId: "root-1",
    branchName: "workflow/run-abc",
    workspaceName: "workflow-run-abc",
    displayName: "Workflow run",
    targetPath: "/home/dev/.proliferate/worktrees/widgets/workflow-run-abc",
    baseRef: "main",
    setupScript: null,
    ...overrides,
  };
}

function deps(overrides: Partial<WorkflowExecutorDeps> = {}): WorkflowExecutorDeps {
  return {
    createWorktree: vi.fn(async () => ({ workspace: { id: "ws-fresh" } }) as never),
    getSetupStatus: vi.fn(async () => ({ status: "succeeded" }) as never),
    startSetup: vi.fn(async () => ({ status: "running" }) as never),
    deliverPlan: vi.fn(async (payload) => ({ workspaceId: payload.workspaceId })),
    ...overrides,
  };
}

describe("executeLocalWorkflowRun (TRAP: plan delivery, never SDK sessions)", () => {
  it("mints a worktree then delivers the resolved plan on the runtime wire", async () => {
    const resolvedPlan = { run_id: "r1", steps: [{ kind: "agent.turn" }] };
    const d = deps();
    const result = await executeLocalWorkflowRun({ deps: d, resolvedPlan, plan: plan() });

    expect(result.workspaceId).toBe("ws-fresh");
    expect(d.createWorktree).toHaveBeenCalledOnce();
    // The ONLY handoff to the runtime is the plan-delivery wire, carrying the
    // fresh worktree + the server-resolved plan verbatim. No session is created
    // by the desktop — that is the runtime's job (ensure_session forced bypass).
    expect(d.deliverPlan).toHaveBeenCalledWith({ plan: resolvedPlan, workspaceId: "ws-fresh" });
    // The dependency surface has no session method — a re-route through the SDK
    // session path would be a compile error, but assert the shape too.
    expect(d).not.toHaveProperty("createSession");
    expect(d).not.toHaveProperty("promptText");
  });

  it("waits for setup to succeed before delivering when a setup script is present", async () => {
    const getSetupStatus = vi
      .fn()
      .mockResolvedValueOnce({ status: "running" })
      .mockResolvedValueOnce({ status: "succeeded" });
    const d = deps({ getSetupStatus: getSetupStatus as never });
    vi.useFakeTimers();
    const promise = executeLocalWorkflowRun({
      deps: d,
      resolvedPlan: {},
      plan: plan({ setupScript: "make setup" }),
    });
    await vi.runAllTimersAsync();
    await promise;
    vi.useRealTimers();
    expect(getSetupStatus).toHaveBeenCalledTimes(2);
    expect(d.deliverPlan).toHaveBeenCalledOnce();
  });

  it("fails with a delivery code (never a partial session) only after exhausting bounded retries", async () => {
    // Finding 4: a persistent runtime rejection is retried up to the bounded cap
    // before the run fails terminally — never on the first blip.
    const deliverPlan = vi.fn(async () => {
      throw new Error("runtime 400");
    });
    const d = deps({ deliverPlan: deliverPlan as never });
    vi.useFakeTimers();
    const promise = executeLocalWorkflowRun({ deps: d, resolvedPlan: {}, plan: plan() });
    const assertion = expect(promise).rejects.toBeInstanceOf(LocalWorkflowExecutorError);
    await vi.runAllTimersAsync();
    await assertion;
    vi.useRealTimers();
    expect(deliverPlan).toHaveBeenCalledTimes(WORKFLOW_LOCAL_DELIVERY_MAX_ATTEMPTS);
  });

  it("retries a transient delivery failure with backoff, then succeeds (finding 4)", async () => {
    const deliverPlan = vi
      .fn()
      .mockRejectedValueOnce(new Error("port briefly closed"))
      .mockResolvedValueOnce({ workspaceId: "ws-fresh" });
    const d = deps({ deliverPlan: deliverPlan as never });
    vi.useFakeTimers();
    const promise = executeLocalWorkflowRun({ deps: d, resolvedPlan: {}, plan: plan() });
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();
    expect(result.workspaceId).toBe("ws-fresh");
    expect(deliverPlan).toHaveBeenCalledTimes(2); // one retry, then success
  });

  it("aborts retry immediately (no backoff) when the claim is lost mid-delivery (finding 4)", async () => {
    let active = true;
    const deliverPlan = vi.fn(async () => {
      active = false; // the claim is lost during the first attempt
      throw new Error("port briefly closed");
    });
    const d = deps({ deliverPlan: deliverPlan as never });
    // Real timers: a lost claim must NOT sit out the backoff — the test would hang
    // if it did. It throws staleClaim before any delay.
    await expect(
      executeLocalWorkflowRun({
        deps: d,
        resolvedPlan: {},
        plan: plan(),
        shouldContinue: () => active,
      }),
    ).rejects.toMatchObject({ code: "stale_claim" });
    expect(deliverPlan).toHaveBeenCalledTimes(1);
  });

  it("aborts before delivery when the claim is lost", async () => {
    const d = deps();
    await expect(
      executeLocalWorkflowRun({
        deps: d,
        resolvedPlan: {},
        plan: plan(),
        shouldContinue: () => false,
      }),
    ).rejects.toMatchObject({ code: "stale_claim" });
    expect(d.createWorktree).not.toHaveBeenCalled();
    expect(d.deliverPlan).not.toHaveBeenCalled();
  });
});
