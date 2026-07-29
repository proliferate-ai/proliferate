import { AnyHarnessError } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  formatSessionCreateCause,
  formatSessionCreateFailureMessage,
  isWorkspaceDirectoryMissingError,
  toSessionCreateFailureDisplayError,
  workspaceDirectoryMissingBlockError,
} from "#product/lib/domain/sessions/creation/create-session-error";

const UNSUPPORTED_MODEL_DETAIL =
  "model 'opus-9' is not supported for agent 'claude': not served by this target";

describe("session create failure presentation", () => {
  it("keeps the runtime's own words for an unsupported model", () => {
    // The rewrite this replaced named neither the model nor the target; the
    // detail names both, and the surfaces that show it say so themselves.
    const error = anyHarnessError("SESSION_MODEL_UNSUPPORTED", UNSUPPORTED_MODEL_DETAIL);

    expect(formatSessionCreateFailureMessage(error)).toBe(UNSUPPORTED_MODEL_DETAIL);
  });

  it("keeps the runtime's own words for an unsupported mode", () => {
    const error = anyHarnessError(
      "SESSION_MODE_UNSUPPORTED",
      "mode 'plan' is not supported for agent 'claude'",
    );

    expect(formatSessionCreateFailureMessage(error)).toBe(
      "mode 'plan' is not supported for agent 'claude'",
    );
  });

  it("wraps unsupported selection errors for caller-facing failure flows", () => {
    const error = anyHarnessError("SESSION_MODEL_UNSUPPORTED", UNSUPPORTED_MODEL_DETAIL);
    const displayError = toSessionCreateFailureDisplayError(error);

    expect(displayError).toBeInstanceOf(Error);
    expect((displayError as Error).message).toBe(UNSUPPORTED_MODEL_DETAIL);
    expect((displayError as Error & { cause?: unknown }).cause).toBe(error);
    // Reached through the wrap: the cause a toast shows is the runtime's text,
    // not the wrapper's.
    expect(formatSessionCreateCause(displayError)).toBe(UNSUPPORTED_MODEL_DETAIL);
  });

  it("identifies missing-worktree errors from the runtime code, the client gate, and causes", () => {
    const runtimeError = anyHarnessError(
      "WORKSPACE_DIRECTORY_MISSING",
      "workspace directory is missing: /tmp/gone",
    );
    const clientGateError = workspaceDirectoryMissingBlockError(
      "Workspace folder no longer exists. Agents can't run in this workspace.",
    );
    const wrapped = new Error("Failed to create session");
    (wrapped as Error & { cause?: unknown }).cause = runtimeError;

    expect(isWorkspaceDirectoryMissingError(runtimeError)).toBe(true);
    expect(isWorkspaceDirectoryMissingError(clientGateError)).toBe(true);
    expect(isWorkspaceDirectoryMissingError(wrapped)).toBe(true);
    expect(isWorkspaceDirectoryMissingError(new Error("network down"))).toBe(false);
    expect(
      isWorkspaceDirectoryMissingError(anyHarnessError("SESSION_MODEL_UNSUPPORTED", "unsupported")),
    ).toBe(false);
  });

  it("preserves generic errors", () => {
    const error = new Error("network down");

    expect(formatSessionCreateFailureMessage(error)).toBe("network down");
    // No prefix: the headline is the caller's to write, so the cause is only
    // ever the failure itself.
    expect(formatSessionCreateCause(error)).toBe("network down");
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
