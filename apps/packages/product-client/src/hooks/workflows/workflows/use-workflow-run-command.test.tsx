// @vitest-environment jsdom

import { AnyHarnessError } from "@anyharness/sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
  type RendererDiagnosticInput,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";
import { prevalidateRendererDiagnostic } from "@/lib/infra/diagnostics/renderer-diagnostic-prevalidate";
import { useWorkflowRunCommand } from "./use-workflow-run-command";

vi.mock("#product/primitives/utils/show-toast", () => ({
  showToast: vi.fn(),
  toastError: vi.fn(),
}));

const records: RendererDiagnosticInput[] = [];

beforeEach(() => {
  records.length = 0;
  setRendererDiagnosticsSink({ emit: (input) => records.push(input) });
});

afterEach(() => {
  cleanup();
  resetRendererDiagnosticsSinkForTest();
  vi.clearAllMocks();
});

function runtimeError(code: string): AnyHarnessError {
  return new AnyHarnessError({
    type: "about:blank",
    title: "Request failed",
    status: 409,
    code,
  });
}

function renderRunCommand() {
  return renderHook(() =>
    useWorkflowRunCommand({ runId: "run-1", refetchRun: vi.fn() }));
}

describe("useWorkflowRunCommand diagnostics", () => {
  it("classifies a 409 race in the prevalidator's charset with run correlation", async () => {
    const { result } = renderRunCommand();

    await act(async () => {
      await result.current(async () => {
        throw runtimeError("WORKFLOW_TRANSITION_ILLEGAL");
      });
    });

    const record = records.find(
      (input) => input.name === "renderer.workflows.run_command_race",
    );
    expect(record).toBeDefined();
    const accepted = prevalidateRendererDiagnostic(record!);
    expect(accepted).not.toBeNull();
    expect(accepted!.errorClassification).toBe("workflow_transition_illegal");
    expect(accepted!.correlation.workflowId).toBe("run-1");
  });

  it("lowercases the problem code on a failed command so the record survives", async () => {
    const { result } = renderRunCommand();

    await act(async () => {
      await result.current(async () => {
        throw runtimeError("WORKFLOW_RUN_NOT_FOUND");
      });
    });

    const record = records.find(
      (input) => input.name === "renderer.workflows.run_command_failed",
    );
    expect(record).toBeDefined();
    const accepted = prevalidateRendererDiagnostic(record!);
    expect(accepted).not.toBeNull();
    expect(accepted!.errorClassification).toBe("workflow_run_not_found");
    expect(accepted!.correlation.workflowId).toBe("run-1");
  });

  it("negative control: the raw uppercase problem code voids the whole record", async () => {
    const { result } = renderRunCommand();

    await act(async () => {
      await result.current(async () => {
        throw runtimeError("WORKFLOW_RUN_NOT_FOUND");
      });
    });

    const record = records.find(
      (input) => input.name === "renderer.workflows.run_command_failed",
    );
    expect(
      prevalidateRendererDiagnostic({
        ...record!,
        errorClassification: "WORKFLOW_RUN_NOT_FOUND",
      }),
    ).toBeNull();
  });
});
