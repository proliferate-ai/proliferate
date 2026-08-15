import { AnyHarnessError } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  WORKFLOW_TRIGGER_FAILURE_FALLBACK_COPY,
  WORKFLOW_TRIGGER_RUNTIME_DISCONNECTED_COPY,
  WORKFLOW_TRIGGER_TIMEOUT_COPY,
} from "#product/copy/workflows/workflow-trigger-failure-copy";
import {
  WorkflowRuntimeNotConnectedError,
  workflowTriggerFailureMessage,
} from "#product/lib/domain/workflows/workflow-trigger-failure";

function runtimeError(status: number, code: string): AnyHarnessError {
  return new AnyHarnessError({
    type: "about:blank",
    title: "Request failed",
    status,
    code,
  });
}

/** The control plane's envelope: status and code at the top level. */
function cloudError(status: number, code: string): Error {
  return Object.assign(new Error("Request failed"), { status, code });
}

describe("workflowTriggerFailureMessage runtime plane", () => {
  it("classifies each runtime problem code from AnyHarnessError.problem", () => {
    expect(workflowTriggerFailureMessage(runtimeError(404, "WORKFLOW_RUN_NOT_FOUND"), "run"))
      .toBe("That run is no longer on this runtime. Start the workflow again to place a new run.");
    expect(workflowTriggerFailureMessage(runtimeError(404, "WORKFLOW_NODE_NOT_FOUND"), "run"))
      .toBe("A step this run needs is missing from the saved workflow. Open the workflow, check its steps, then start it again.");
    expect(workflowTriggerFailureMessage(runtimeError(409, "WORKFLOW_TRANSITION_ILLEGAL"), "run"))
      .toBe("This run has already moved on from that step. Open the run to see where it is now.");
    expect(workflowTriggerFailureMessage(runtimeError(422, "WORKFLOW_SNAPSHOT_INVALID"), "run"))
      .toBe("This workflow cannot run as saved. Open it in the editor, fix the steps it reports, then start it again.");
    expect(workflowTriggerFailureMessage(
      runtimeError(500, "WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED"),
      "run",
    )).toBe("The workspace for this run could not be created. Check the selected repository is still on disk, then start the run again.");
  });

  it("falls back for an unknown runtime code", () => {
    expect(workflowTriggerFailureMessage(runtimeError(500, "WORKFLOW_SOMETHING_NEW"), "run"))
      .toBe(WORKFLOW_TRIGGER_FAILURE_FALLBACK_COPY);
  });

  it("falls back for a coded runtime error the copy table does not know, not for an uncoded one", () => {
    expect(workflowTriggerFailureMessage(
      new AnyHarnessError({ type: "about:blank", title: "Request failed", status: 500 }),
      "run",
    )).toBe(WORKFLOW_TRIGGER_FAILURE_FALLBACK_COPY);
  });
});

describe("workflowTriggerFailureMessage control plane", () => {
  it("classifies the invocation codes from the top-level envelope", () => {
    expect(workflowTriggerFailureMessage(
      cloudError(409, "workflow_invocation_conflict"),
      "invocation",
    )).toBe("That run was already started with different inputs. Start it again to place a new run.");
    expect(workflowTriggerFailureMessage(
      cloudError(400, "invalid_workflow_invocation"),
      "invocation",
    )).toBe("These inputs were rejected. Check the required inputs and the selected repository, then start the run again.");
  });

  it("falls back for an unknown control-plane code", () => {
    expect(workflowTriggerFailureMessage(cloudError(503, "something_else"), "invocation"))
      .toBe(WORKFLOW_TRIGGER_FAILURE_FALLBACK_COPY);
  });
});

describe("workflowTriggerFailureMessage uncoded failures", () => {
  it("names the disconnected runtime when no runtime is tracked", () => {
    expect(workflowTriggerFailureMessage(new WorkflowRuntimeNotConnectedError(), "run"))
      .toBe(WORKFLOW_TRIGGER_RUNTIME_DISCONNECTED_COPY);
  });

  it("names the disconnected runtime when the run PUT's transport never answered", () => {
    expect(workflowTriggerFailureMessage(new TypeError("Failed to fetch"), "run"))
      .toBe(WORKFLOW_TRIGGER_RUNTIME_DISCONNECTED_COPY);
  });

  it("does not blame the local runtime for a control-plane transport failure", () => {
    expect(workflowTriggerFailureMessage(new TypeError("Failed to fetch"), "invocation"))
      .toBe(WORKFLOW_TRIGGER_FAILURE_FALLBACK_COPY);
  });

  it("keeps the timeout wording, which says the run may still exist", () => {
    const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(workflowTriggerFailureMessage(aborted, "run")).toBe(WORKFLOW_TRIGGER_TIMEOUT_COPY);
  });

  it("falls back for an error with no plane envelope at all", () => {
    expect(workflowTriggerFailureMessage(new Error("boom"), null))
      .toBe(WORKFLOW_TRIGGER_FAILURE_FALLBACK_COPY);
  });
});
