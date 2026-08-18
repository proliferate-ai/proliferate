import { describe, expect, it } from "vitest";
import { reduceEvents } from "../../index.js";

describe("workspace pin intent reducer behavior", () => {
  it("treats the event as metadata, not transcript content", () => {
    const state = reduceEvents(
      [
        {
          sessionId: "session-1",
          seq: 1,
          timestamp: "2026-08-17T00:00:01Z",
          event: {
            type: "workspace_pin_intent",
            requestId: "11111111-1111-4111-8111-111111111111",
            runtimeId: "runtime-1",
            sourceSessionId: "session-1",
            workspaceId: "workspace-1",
            pinned: true,
          },
        },
      ],
      "session-1",
    );

    expect(Object.keys(state.itemsById)).toEqual([]);
    expect(state.turnOrder).toEqual([]);
    expect(state.unknownEvents).toEqual([]);
    expect(state.lastSeq).toBe(1);
  });
});
