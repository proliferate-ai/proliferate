import type { SessionEventEnvelope } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchWorkspacePinIntentEnvelopes,
  registerWorkspacePinIntentReconciler,
  resetWorkspacePinIntentDispatchForTests,
} from "#product/hooks/sessions/lifecycle/workspace-pin-intent-dispatch";
import { resetWorkspacePinLocalOrderForTests } from "#product/stores/preferences/workspace-ui-pin-local-order";

beforeEach(() => {
  resetWorkspacePinLocalOrderForTests();
});

afterEach(() => {
  resetWorkspacePinIntentDispatchForTests();
});

describe("workspace pin intent dispatch", () => {
  it("buffers only typed pin intents until the authenticated reconciler mounts", () => {
    const reconcile = vi.fn();

    dispatchWorkspacePinIntentEnvelopes([
      envelope(1, "session_started"),
      envelope(2, "workspace_pin_intent"),
    ], "history");
    const unregister = registerWorkspacePinIntentReconciler(reconcile);

    expect(reconcile).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledWith([{
      envelope: envelope(2, "workspace_pin_intent"),
      observedAt: {
        rendererEpoch: expect.any(String),
        sequence: 1,
      },
      provenance: "history",
    }]);

    unregister();
    dispatchWorkspacePinIntentEnvelopes([envelope(3, "workspace_pin_intent")], "live");
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it("bounds startup buffering and preserves the newest intent order", () => {
    const reconcile = vi.fn();
    dispatchWorkspacePinIntentEnvelopes(
      Array.from({ length: 130 }, (_, index) => (
        envelope(index + 1, "workspace_pin_intent")
      )),
      "history",
    );

    registerWorkspacePinIntentReconciler(reconcile);

    const delivered = reconcile.mock.calls[0]?.[0] ?? [];
    expect(delivered).toHaveLength(128);
    expect(delivered[0]?.envelope.seq).toBe(3);
    expect(delivered.at(-1)?.envelope.seq).toBe(130);
    expect(delivered.every((observation) => observation.provenance === "history")).toBe(true);
  });

  it("delivers directly while a reconciler is registered", () => {
    const reconcile = vi.fn();
    registerWorkspacePinIntentReconciler(reconcile);

    dispatchWorkspacePinIntentEnvelopes([envelope(4, "workspace_pin_intent")], "live");

    expect(reconcile).toHaveBeenCalledWith([expect.objectContaining({
      envelope: envelope(4, "workspace_pin_intent"),
      provenance: "live",
    })]);
  });
});

function envelope(
  seq: number,
  type: "session_started" | "workspace_pin_intent",
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: "2026-08-17T00:00:00Z",
    event: type === "workspace_pin_intent"
      ? {
          type,
          requestId: "11111111-1111-4111-8111-111111111111",
          runtimeId: "runtime-1",
          sourceSessionId: "session-1",
          workspaceId: "workspace-1",
          pinned: true,
        }
      : { type },
  } as SessionEventEnvelope;
}
