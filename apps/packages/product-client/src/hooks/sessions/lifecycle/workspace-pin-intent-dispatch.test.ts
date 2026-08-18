import type { SessionEventEnvelope } from "@anyharness/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatchWorkspacePinIntentEnvelopes,
  registerWorkspacePinIntentReconciler,
  resetWorkspacePinIntentDispatchForTests,
} from "#product/hooks/sessions/lifecycle/workspace-pin-intent-dispatch";

afterEach(() => {
  resetWorkspacePinIntentDispatchForTests();
});

describe("workspace pin intent dispatch", () => {
  it("buffers only typed pin intents until the authenticated reconciler mounts", () => {
    const reconcile = vi.fn();

    dispatchWorkspacePinIntentEnvelopes([
      envelope(1, "session_started"),
      envelope(2, "workspace_pin_intent"),
    ]);
    const unregister = registerWorkspacePinIntentReconciler(reconcile);

    expect(reconcile).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledWith([envelope(2, "workspace_pin_intent")]);

    unregister();
    dispatchWorkspacePinIntentEnvelopes([envelope(3, "workspace_pin_intent")]);
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it("bounds startup buffering and preserves the newest intent order", () => {
    const reconcile = vi.fn();
    dispatchWorkspacePinIntentEnvelopes(
      Array.from({ length: 130 }, (_, index) => (
        envelope(index + 1, "workspace_pin_intent")
      )),
    );

    registerWorkspacePinIntentReconciler(reconcile);

    const delivered = reconcile.mock.calls[0]?.[0] as SessionEventEnvelope[];
    expect(delivered).toHaveLength(128);
    expect(delivered[0]?.seq).toBe(3);
    expect(delivered.at(-1)?.seq).toBe(130);
  });

  it("delivers directly while a reconciler is registered", () => {
    const reconcile = vi.fn();
    registerWorkspacePinIntentReconciler(reconcile);

    dispatchWorkspacePinIntentEnvelopes([envelope(4, "workspace_pin_intent")]);

    expect(reconcile).toHaveBeenCalledWith([envelope(4, "workspace_pin_intent")]);
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
