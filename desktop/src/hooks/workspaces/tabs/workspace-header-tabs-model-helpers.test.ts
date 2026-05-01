import { describe, expect, it } from "vitest";
import type { Session } from "@anyharness/sdk";
import type { SessionSlot } from "@/stores/sessions/harness-store";
import { getKnownSessionCanFork } from "@/hooks/workspaces/tabs/workspace-header-tabs-model-helpers";

function idleSlot(canFork: boolean): SessionSlot {
  return {
    status: "idle",
    actionCapabilities: { fork: canFork, targetedFork: false },
    executionSummary: {
      phase: "idle",
      hasLiveHandle: true,
      pendingInteractions: [],
      updatedAt: "2026-05-01T00:00:00Z",
    },
    streamConnectionState: "open",
    transcript: {
      isStreaming: false,
      pendingInteractions: [],
    },
  } as unknown as SessionSlot;
}

function session(canFork: boolean): Session {
  return {
    status: "idle",
    dismissedAt: null,
    actionCapabilities: { fork: canFork, targetedFork: false },
  } as Session;
}

describe("getKnownSessionCanFork", () => {
  it("uses persisted session capabilities when the live slot is stale", () => {
    expect(getKnownSessionCanFork({
      kind: "slot",
      slot: idleSlot(false),
      session: session(true),
    })).toBe(true);
  });
});
