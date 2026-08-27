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

  it("keeps the server-sent words for the launch-refusal codes", () => {
    // agent_auth flow 3: the runtime 409 carries plain-words detail since
    // slice 1 — those words always win over any client copy.
    const cooling = anyHarnessError(
      "AGENT_ROUTE_SEAT_COOLING",
      "Your Claude.ai login is cooling down until 6:00 PM.",
    );
    const allCooling = anyHarnessError(
      "AGENT_ROUTE_ALL_SEATS_COOLING",
      "All Claude.ai logins are cooling — the earliest resets at 6:00 PM.",
    );
    const missing = anyHarnessError(
      "AGENT_ROUTE_SELECTION_MISSING",
      "Claude Code isn't set up — pick a method in Settings.",
    );

    expect(formatSessionCreateFailureMessage(cooling)).toBe(
      "Your Claude.ai login is cooling down until 6:00 PM.",
    );
    expect(formatSessionCreateFailureMessage(allCooling)).toBe(
      "All Claude.ai logins are cooling — the earliest resets at 6:00 PM.",
    );
    expect(formatSessionCreateFailureMessage(missing)).toBe(
      "Claude Code isn't set up — pick a method in Settings.",
    );
    // The cause path (one wrap) reaches the same words.
    const wrapped = new Error("Failed to create session");
    (wrapped as Error & { cause?: unknown }).cause = cooling;
    expect(formatSessionCreateCause(wrapped)).toBe(
      "Your Claude.ai login is cooling down until 6:00 PM.",
    );
  });

  it("never renders a bare AGENT_ROUTE_*/SEAT_* code to a human", () => {
    // A refusal that arrived with the code echoed as its own detail falls to
    // the plain-words fallback copy, never the code string.
    for (
      const code of [
        "AGENT_ROUTE_SEAT_COOLING",
        "AGENT_ROUTE_ALL_SEATS_COOLING",
        "AGENT_ROUTE_SELECTION_MISSING",
      ]
    ) {
      const bare = anyHarnessError(code, code);
      const message = formatSessionCreateFailureMessage(bare);
      expect(message).not.toContain(code);
      expect(message).not.toMatch(/^[A-Z][A-Z0-9_]*$/);
      // The fallback names the cause, not generic envelope boilerplate.
      expect(message.length).toBeGreaterThan(20);
      expect(formatSessionCreateCause(bare)).toBe(message);
    }
    expect(
      formatSessionCreateFailureMessage(
        anyHarnessError("AGENT_ROUTE_SELECTION_MISSING", "AGENT_ROUTE_SELECTION_MISSING"),
      ),
    ).toBe("This agent isn't set up to authenticate yet. Pick a method in Settings.");
    // An UNKNOWN coded failure whose message is a naked code degrades to the
    // generic plain-words fallback.
    const unknown = new Error("SEAT_ROTATION_EXPLODED");
    expect(formatSessionCreateFailureMessage(unknown)).toBe(
      "The session could not start. Try again.",
    );
    expect(formatSessionCreateCause(unknown)).toBe(
      "The session could not start. Try again.",
    );
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
