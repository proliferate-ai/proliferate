import { AnyHarnessError } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  formatSessionCreateFailureMessage,
  formatSessionCreateToastMessage,
  toSessionCreateFailureDisplayError,
} from "@/lib/domain/sessions/creation/create-session-error";

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
