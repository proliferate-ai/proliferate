import { describe, expect, it } from "vitest";
import {
  collectInactiveSessionStreamIds,
  createEmptySessionSlot,
} from "./session-runtime";

describe("collectInactiveSessionStreamIds", () => {
  it("initializes empty pending config changes on new slots", () => {
    expect(createEmptySessionSlot("session-1", "codex").pendingConfigChanges).toEqual({});
  });

  it("prunes only idle, non-pending sessions with open stream handles", () => {
    const idleSlot = {
      ...createEmptySessionSlot("session-idle", "codex"),
      streamConnectionState: "open" as const,
      sseHandle: { close() {} },
      transcriptHydrated: true,
      status: "idle" as const,
    };
    const workingSlot = {
      ...createEmptySessionSlot("session-working", "codex"),
      streamConnectionState: "open" as const,
      sseHandle: { close() {} },
      transcriptHydrated: true,
      status: "running" as const,
    };
    const pendingSlot = {
      ...createEmptySessionSlot("pending-session:codex:1:abc123", "codex"),
      streamConnectionState: "open" as const,
      sseHandle: { close() {} },
      transcriptHydrated: true,
      status: "idle" as const,
    };

    const prunableSessionIds = collectInactiveSessionStreamIds({
      "session-idle": idleSlot,
      "session-working": workingSlot,
      "pending-session:codex:1:abc123": pendingSlot,
    }, {
      preserveSessionIds: ["session-working"],
    });

    expect(prunableSessionIds).toEqual(["session-idle"]);
  });
});
