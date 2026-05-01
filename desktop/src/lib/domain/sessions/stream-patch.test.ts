import { describe, expect, it } from "vitest";
import {
  createTranscriptState,
  type SessionEventEnvelope,
} from "@anyharness/sdk";
import {
  buildSessionStreamBatchPatch,
  type SessionStreamPatchInput,
} from "@/lib/domain/sessions/stream-patch";

describe("buildSessionStreamBatchPatch", () => {
  it("preserves null session titles while folding later events", () => {
    const patch = buildSessionStreamBatchPatch({
      slot: slot({ title: "Old title" }),
      nextTranscript: createTranscriptState("session-1"),
      envelopes: [
        sessionInfoUpdate(2, null),
        usageUpdate(3),
      ],
    });

    expect(patch.title).toBeNull();
  });

  it("leaves title unchanged when a batch has no session title update", () => {
    const patch = buildSessionStreamBatchPatch({
      slot: slot({ title: "Old title" }),
      nextTranscript: createTranscriptState("session-1"),
      envelopes: [usageUpdate(2)],
    });

    expect(patch.title).toBeUndefined();
  });
});

function slot(
  overrides?: Partial<SessionStreamPatchInput["slot"]>,
): SessionStreamPatchInput["slot"] {
  return {
    modelId: "model-1",
    modeId: "mode-1",
    title: "Title",
    status: "running",
    executionSummary: null,
    ...overrides,
  };
}

function sessionInfoUpdate(
  seq: number,
  title: string | null,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    event: {
      type: "session_info_update",
      title,
    },
  } as SessionEventEnvelope;
}

function usageUpdate(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    event: {
      type: "usage_update",
    },
  } as SessionEventEnvelope;
}
