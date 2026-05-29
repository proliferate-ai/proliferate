import { createTranscriptState, selectPendingApprovalInteraction, type Session } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import { buildSessionSlotPatchFromSummary } from "./summary";

describe("session summary patching", () => {
  it("hydrates pending approval state from execution summary", () => {
    const transcript = createTranscriptState("session-1");
    const patch = buildSessionSlotPatchFromSummary(
      {
        id: "session-1",
        workspaceId: "workspace-1",
        agentKind: "codex",
        status: "running",
        createdAt: "2026-04-15T00:00:00Z",
        updatedAt: "2026-04-15T00:00:01Z",
        executionSummary: {
          phase: "awaiting_interaction",
          hasLiveHandle: true,
          updatedAt: "2026-04-15T00:00:01Z",
          pendingInteractions: [{
            requestId: "perm-1",
            kind: "permission",
            title: "Run command",
            description: "Approve command execution",
            source: {
              toolCallId: "tool-1",
              toolKind: "execute",
              toolStatus: "pending",
            },
            payload: {
              type: "permission",
              options: [
                { optionId: "allow-once", label: "Allow once", kind: "allow_once" },
              ],
            },
          }],
        },
      } as Session,
      "workspace-1",
      transcript,
    );

    expect(selectPendingApprovalInteraction(patch.transcript)).toMatchObject({
      requestId: "perm-1",
      toolCallId: "tool-1",
      toolKind: "execute",
      toolStatus: "pending",
      options: [
        { optionId: "allow-once", label: "Allow once", kind: "allow_once" },
      ],
    });
  });
});
