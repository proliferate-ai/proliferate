import type {
  WorkflowInvocationCreateRequestV2,
  WorkflowInvocationV2,
} from "@proliferate/cloud-sdk";
import type {
  WorkflowRunProjectionV2,
  WorkflowRunPutRequestV2,
} from "@anyharness/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  runWorkflowTrigger,
  WorkflowTriggerError,
  workflowTriggerErrorIds,
  type TriggerCourierDeps,
  type TriggerCourierInput,
} from "#product/lib/workflows/trigger/trigger-courier";

const input: TriggerCourierInput = {
  workflowDefinitionId: "definition-1",
  // Deliberately un-normalized: the fake control plane trims it, so a courier
  // that rebuilt the run body from `input` would be visible in the assertions.
  arguments: { issue: "  PRO-174  " },
  placement: { repoConfigId: "repo-1", mode: "worktree" },
};

describe("runWorkflowTrigger", () => {
  it("places the invocation before the run and forwards the frozen record", async () => {
    const { deps, calls, frozen } = courierFakes();

    const result = await runWorkflowTrigger(deps, input);

    expect(calls).toEqual([
      { step: "invocation", id: "id-1" },
      { step: "run", id: "id-2" },
    ]);
    expect(result).toMatchObject({
      invocationId: "id-1",
      runId: "id-2",
      workspaceId: "workspace-1",
    });

    // The run is placed against the control plane's frozen record — same
    // object, server-normalized argument, and the definition snapshot the
    // caller never had — not a body rebuilt from `input`.
    const runBody = vi.mocked(deps.putRun).mock.calls[0]?.[1];
    expect(runBody).toBe(frozen().invocationJson);
    expect(runBody?.arguments).toEqual({ issue: "PRO-174" });
    expect(runBody?.arguments).not.toEqual(input.arguments);
    expect(runBody?.definition.nodes).toHaveLength(1);
  });

  it("never places the run when the invocation fails", async () => {
    const { deps } = courierFakes({
      putInvocation: vi.fn(async () => {
        throw new Error("control plane rejected the invocation");
      }),
    });

    const caught = await runWorkflowTrigger(deps, input).catch((error) => error);

    expect(caught).toBeInstanceOf(WorkflowTriggerError);
    expect((caught as WorkflowTriggerError).stage).toBe("invocation");
    expect(deps.putRun).not.toHaveBeenCalled();
  });

  it("re-fires both PUTs under the same ids when a runtime failure is retried", async () => {
    const runtimeFailure = courierFakes({
      putRun: vi.fn(async () => {
        throw new Error("runtime unreachable");
      }),
    });

    const caught = await runWorkflowTrigger(runtimeFailure.deps, input)
      .catch((error) => error);

    expect(caught).toBeInstanceOf(WorkflowTriggerError);
    expect((caught as WorkflowTriggerError).stage).toBe("run");
    const ids = workflowTriggerErrorIds(caught);
    expect(ids).toEqual({ invocationId: "id-1", runId: "id-2" });
    expect(runtimeFailure.calls).toEqual([{ step: "invocation", id: "id-1" }]);
    expect(runtimeFailure.deps.putRun).toHaveBeenCalledWith("id-2", expect.anything());

    // A fresh courier run (fresh minting counter) still replays the failed
    // identity, because the retry supplies the ids the failure handed back.
    const retry = courierFakes();
    const result = await runWorkflowTrigger(retry.deps, input, ids ?? {});

    expect(retry.calls).toEqual([
      { step: "invocation", id: "id-1" },
      { step: "run", id: "id-2" },
    ]);
    expect(result.invocationId).toBe("id-1");
    expect(result.runId).toBe("id-2");
    expect(retry.deps.mintId).not.toHaveBeenCalled();
  });

  it("mints a distinct invocation/run pair for every fresh trigger", async () => {
    const shared = sequentialIds();
    const first = await runWorkflowTrigger(courierFakes({ mintId: shared }).deps, input);
    const second = await runWorkflowTrigger(courierFakes({ mintId: shared }).deps, input);

    expect(first.invocationId).not.toBe(first.runId);
    expect(second.invocationId).not.toBe(first.invocationId);
    expect(second.runId).not.toBe(first.runId);
  });
});

interface CourierCall {
  step: "invocation" | "run";
  id: string;
}

function sequentialIds(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `id-${next}`;
  };
}

/**
 * Fake deps whose control plane returns a record that differs from the input
 * in two detectable ways — a trimmed argument and the frozen definition
 * snapshot — so "forwards the server's record" is distinguishable from
 * "rebuilds the body from the caller's input".
 */
function courierFakes(overrides: Partial<TriggerCourierDeps> = {}): {
  deps: TriggerCourierDeps;
  calls: CourierCall[];
  frozen: () => WorkflowInvocationV2;
} {
  const calls: CourierCall[] = [];
  let frozenRecord: WorkflowInvocationV2 | null = null;

  const deps: TriggerCourierDeps = {
    mintId: vi.fn(sequentialIds()),
    putInvocation: vi.fn(async (
      invocationId: string,
      body: WorkflowInvocationCreateRequestV2,
    ) => {
      calls.push({ step: "invocation", id: invocationId });
      frozenRecord = frozenInvocation(invocationId, body);
      return frozenRecord;
    }),
    putRun: vi.fn(async (runId: string, _body: WorkflowRunPutRequestV2) => {
      calls.push({ step: "run", id: runId });
      return runProjection(runId);
    }),
    ...overrides,
  };

  return {
    deps,
    calls,
    frozen: () => {
      if (!frozenRecord) {
        throw new Error("the fake control plane was never called");
      }
      return frozenRecord;
    },
  };
}

function frozenInvocation(
  invocationId: string,
  body: WorkflowInvocationCreateRequestV2,
): WorkflowInvocationV2 {
  return {
    id: invocationId,
    workflowDefinitionId: body.workflowDefinitionId,
    invocationJson: {
      schemaVersion: 2,
      workflowDefinitionId: body.workflowDefinitionId,
      definition: {
        schemaVersion: 2,
        nodes: [{
          id: "node-1",
          type: "agent",
          title: "Diagnose",
          prompt: "Investigate @input:issue",
        }],
        edges: [],
        inputs: [{ name: "issue", required: true }],
        docTemplates: [],
      },
      arguments: Object.fromEntries(
        Object.entries(body.arguments).map(([name, value]) => [
          name,
          typeof value === "string" ? value.trim() : value,
        ]),
      ),
      placement: body.placement,
    },
    createdAt: "2026-08-14T12:00:00Z",
  };
}

function runProjection(runId: string): WorkflowRunProjectionV2 {
  return {
    run: {
      id: runId,
      invocationId: "id-1",
      definitionJson: "{}",
      argumentsJson: "{}",
      workspaceId: "workspace-1",
      status: "running",
      currentNodeRowId: null,
      failureCode: null,
      interruptionCode: null,
      createdAt: "2026-08-14T12:00:01Z",
      updatedAt: "2026-08-14T12:00:01Z",
      completedAt: null,
    },
    nodes: [],
    docs: [],
  };
}
