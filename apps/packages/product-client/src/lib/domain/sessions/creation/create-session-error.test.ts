import { AnyHarnessError } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  formatSessionCreateFailureMessage,
  formatSessionCreateToastMessage,
  isWorkspaceDirectoryMissingError,
  toSessionCreateFailureDisplayError,
} from "#product/lib/domain/sessions/creation/create-session-error";
import { WORKTREE_MISSING_SEND_BLOCKED_REASON } from "#product/lib/domain/workspaces/availability";

describe("session create failure presentation", () => {
  it("maps unsupported model errors to target update guidance", () => {
    const error = anyHarnessError("SESSION_MODEL_UNSUPPORTED", "Unsupported model");

    expect(formatSessionCreateFailureMessage(error)).toBe(
      "This target does not support the selected model yet. Update AnyHarness on the target or choose another model.",
    );
  });

  it("maps unsupported mode errors to target update guidance", () => {
    const error = anyHarnessError("SESSION_MODE_UNSUPPORTED", "Unsupported mode");

    expect(formatSessionCreateFailureMessage(error)).toBe(
      "This target does not support the selected session mode yet. Update AnyHarness on the target or choose another mode.",
    );
  });

  it("wraps unsupported selection errors for caller-facing failure flows", () => {
    const error = anyHarnessError("SESSION_MODEL_UNSUPPORTED", "Unsupported model");
    const displayError = toSessionCreateFailureDisplayError(error);

    expect(displayError).toBeInstanceOf(Error);
    expect((displayError as Error).message).toContain("choose another model");
    expect((displayError as Error & { cause?: unknown }).cause).toBe(error);
    expect(formatSessionCreateToastMessage(displayError, "Failed to open chat")).toBe(
      "This target does not support the selected model yet. Update AnyHarness on the target or choose another model.",
    );
  });

  it("maps gated model errors to actionable guidance without internal context ids", () => {
    const error = new AnyHarnessError({
      type: "about:blank",
      title: "Bad request",
      status: 400,
      code: "SESSION_MODEL_GATED",
      detail: "gated",
      instance: null,
      requiredContexts: ["anthropic-api", "gateway"],
    });

    expect(formatSessionCreateFailureMessage(error)).toBe(
      "This model is not available for the current authentication method. Choose an available model or change agent authentication in Settings, then try again.",
    );
    expect(formatSessionCreateFailureMessage(error)).not.toContain("anthropic-api");
    expect(formatSessionCreateFailureMessage(error)).not.toContain("gateway");
  });

  it("identifies missing-worktree errors from the runtime code, the client gate, and causes", () => {
    const runtimeError = anyHarnessError(
      "WORKSPACE_DIRECTORY_MISSING",
      "workspace directory is missing: /tmp/gone",
    );
    const clientGateError = new Error(WORKTREE_MISSING_SEND_BLOCKED_REASON);
    const wrapped = new Error("Failed to create session");
    (wrapped as Error & { cause?: unknown }).cause = runtimeError;

    expect(isWorkspaceDirectoryMissingError(runtimeError)).toBe(true);
    expect(isWorkspaceDirectoryMissingError(clientGateError)).toBe(true);
    expect(isWorkspaceDirectoryMissingError(wrapped)).toBe(true);
    expect(isWorkspaceDirectoryMissingError(new Error("network down"))).toBe(false);
    expect(isWorkspaceDirectoryMissingError(anyHarnessError("SESSION_MODEL_GATED", "gated"))).toBe(false);
  });

  it("preserves generic errors", () => {
    const error = new Error("network down");

    expect(formatSessionCreateFailureMessage(error)).toBe("network down");
    expect(formatSessionCreateToastMessage(error, "Failed to open chat")).toBe(
      "Failed to open chat: network down",
    );
    expect(toSessionCreateFailureDisplayError(error)).toBe(error);
  });
});

function anyHarnessError(code: string, detail: string): AnyHarnessError {
  return new AnyHarnessError({
    type: "about:blank",
    title: "Session create failed",
    status: 400,
    code,
    detail,
    instance: null,
  });
}
