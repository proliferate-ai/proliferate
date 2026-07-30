import { AnyHarnessError } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  MODEL_UNSUPPORTED_ROW_HINT,
  modelSupportRefusalKey,
  modelUnsupportedControlMessage,
  readModelSupportRefusal,
} from "#product/lib/domain/chat/models/model-support-refusals";

const SELECTION = { kind: "claude", modelId: "opus-9" } as const;

function refusalError(detail = "model 'opus-9' is not supported for agent 'claude'"): AnyHarnessError {
  return new AnyHarnessError({
    type: "about:blank",
    title: "Session create failed",
    status: 400,
    code: "SESSION_MODEL_UNSUPPORTED",
    detail,
    instance: null,
  });
}

function wrap(cause: unknown, message = "Failed to create session"): Error {
  const error = new Error(message);
  (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

describe("readModelSupportRefusal", () => {
  it("reads the refusal off a bare runtime error", () => {
    const refusal = readModelSupportRefusal(refusalError(), {
      workspaceId: "ws-1",
      selection: SELECTION,
    });

    expect(refusal).toEqual({
      workspaceId: "ws-1",
      agentKind: "claude",
      modelId: "opus-9",
      detail: "model 'opus-9' is not supported for agent 'claude'",
    });
  });

  it("follows the cause chain, because the creation workflow wraps the error", () => {
    const refusal = readModelSupportRefusal(wrap(wrap(refusalError())), {
      workspaceId: "ws-1",
      selection: SELECTION,
    });

    expect(refusal?.modelId).toBe("opus-9");
  });

  it("falls back to the problem title when the runtime sends no detail", () => {
    const noDetail = new AnyHarnessError({
      type: "about:blank",
      title: "Session create failed",
      status: 400,
      code: "SESSION_MODEL_UNSUPPORTED",
      detail: null,
      instance: null,
    });

    expect(
      readModelSupportRefusal(noDetail, { workspaceId: "ws-1", selection: SELECTION })?.detail,
    ).toBe("Session create failed");
  });

  it("records nothing without a workspace, because a refusal is scoped to a target", () => {
    expect(
      readModelSupportRefusal(refusalError(), { workspaceId: null, selection: SELECTION }),
    ).toBeNull();
  });

  it("ignores other failures, including neighbouring runtime refusals", () => {
    const modeRefusal = new AnyHarnessError({
      type: "about:blank",
      title: "Session create failed",
      status: 400,
      code: "SESSION_MODE_UNSUPPORTED",
      detail: "mode 'plan' is not supported",
      instance: null,
    });

    for (const error of [new Error("network down"), modeRefusal, wrap(new Error("boom")), null]) {
      expect(readModelSupportRefusal(error, { workspaceId: "ws-1", selection: SELECTION }))
        .toBeNull();
    }
  });

  it("terminates on a self-referential cause chain", () => {
    const looping = new Error("looping");
    (looping as Error & { cause?: unknown }).cause = looping;

    expect(readModelSupportRefusal(looping, { workspaceId: "ws-1", selection: SELECTION }))
      .toBeNull();
  });
});

describe("refusal copy", () => {
  it("keys a refusal by workspace, harness and model", () => {
    expect(modelSupportRefusalKey({
      workspaceId: "ws-1",
      agentKind: "claude",
      modelId: "opus-9",
    })).not.toBe(modelSupportRefusalKey({
      workspaceId: "ws-2",
      agentKind: "claude",
      modelId: "opus-9",
    }));
  });

  it("names the model and the target in the pinned message", () => {
    const message = modelUnsupportedControlMessage({
      modelDisplayName: "Opus 9",
      targetLabel: "proliferate",
    });

    expect(message).toContain("Opus 9");
    expect(message).toContain("proliferate");
  });

  it("predicts no remedy it cannot verify", () => {
    // No catalog entry carries a per-model minimum runtime version, so naming a
    // version — or an upgrade at all — sends people to check a number no surface
    // can confirm. The row hint beside it already refuses to; this is the same
    // refusal, pinned so the sentence cannot drift back.
    const messages = [
      modelUnsupportedControlMessage({
        modelDisplayName: "Opus 9",
        targetLabel: "proliferate",
      }),
      modelUnsupportedControlMessage({
        modelDisplayName: "Opus 9",
        targetLabel: null,
      }),
      MODEL_UNSUPPORTED_ROW_HINT,
    ];

    for (const message of messages) {
      expect(message).not.toMatch(/newer|upgrade|update|version/i);
    }
  });

  it("never says only 'the selected model' or 'the target'", () => {
    const withTarget = modelUnsupportedControlMessage({
      modelDisplayName: "Opus 9",
      targetLabel: "proliferate",
    });
    const withoutTarget = modelUnsupportedControlMessage({
      modelDisplayName: "Opus 9",
      targetLabel: null,
    });

    for (const message of [withTarget, withoutTarget, MODEL_UNSUPPORTED_ROW_HINT]) {
      expect(message).not.toContain("the selected model");
    }
    // The unnamed-target fallback still names the model; only the target is
    // generic, and only because nothing knew its name.
    expect(withoutTarget).toContain("Opus 9");
  });
});
