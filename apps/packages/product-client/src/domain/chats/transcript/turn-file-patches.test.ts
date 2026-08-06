import { createTranscriptState, type TranscriptState } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  collectTurnFilePatches,
  collectTurnFileRevertPatchEntries,
} from "./turn-file-patches";

describe("turn file patch collection", () => {
  it("keeps undo entries aligned with visible top-level file changes", () => {
    const transcript = transcriptWithTurn([
      toolItem("top", "src/app.ts", "diff --git a/src/app.ts b/src/app.ts\n"),
      toolItem("child", "src/child.ts", null, "parent-tool"),
      toolItem("hidden", ".claude/worktrees/tmp/file.ts", null),
    ]);
    const turn = transcript.turnsById["turn-1"];

    expect(collectTurnFilePatches(turn, transcript).map((file) => file.path)).toEqual([
      "src/app.ts",
    ]);
    expect(collectTurnFileRevertPatchEntries(turn, transcript)).toMatchObject({
      entries: [{
        path: "src/app.ts",
        oldPath: null,
        operation: "edit",
        patch: "diff --git a/src/app.ts b/src/app.ts",
      }],
      blockedReason: null,
    });
  });
});

function transcriptWithTurn(items: Array<Record<string, unknown>>): TranscriptState {
  const transcript = createTranscriptState("session-1");
  transcript.turnOrder = ["turn-1"];
  transcript.turnsById = {
    "turn-1": {
      turnId: "turn-1",
      itemOrder: items.map((item) => String(item.itemId)),
      startedAt: "2026-04-04T00:00:00Z",
      completedAt: "2026-04-04T00:00:30Z",
      stopReason: "end_turn",
      fileBadges: [],
    },
  };
  transcript.itemsById = Object.fromEntries(items.map((item) => [
    String(item.itemId),
    item,
  ])) as unknown as TranscriptState["itemsById"];
  return transcript;
}

function toolItem(
  itemId: string,
  path: string,
  patch: string | null,
  parentToolCallId: string | null = null,
) {
  return {
    itemId,
    turnId: "turn-1",
    kind: "tool_call",
    status: "completed",
    sourceAgentKind: "codex",
    messageId: null,
    title: null,
    nativeToolName: "Edit",
    parentToolCallId,
    toolCallId: itemId,
    toolKind: "edit",
    semanticKind: "edit",
    approvalState: "none",
    rawInput: undefined,
    rawOutput: undefined,
    timestamp: "2026-04-04T00:00:00Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: 1,
    completedAt: "2026-04-04T00:00:01Z",
    contentParts: [{
      type: "file_change",
      operation: "edit",
      path,
      workspacePath: path,
      newPath: null,
      newWorkspacePath: null,
      patch,
      patchTruncated: false,
    }],
  };
}
