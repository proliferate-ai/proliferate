import { createTranscriptState, type TranscriptState } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import { collectLatestCompletedTurnTouchedFiles } from "./last-turn-file-changes";

describe("collectLatestCompletedTurnTouchedFiles", () => {
  it("uses the latest completed turn when the newest turn is still running", () => {
    const transcript = transcriptWithTurns([
      {
        turnId: "turn-1",
        completedAt: "2026-04-04T00:00:30Z",
        items: [toolItem("tool-1", "turn-1", "src/old.ts", "src/new.ts")],
      },
      {
        turnId: "turn-2",
        completedAt: null,
        items: [toolItem("tool-2", "turn-2", "src/running.ts")],
      },
    ]);

    const result = collectLatestCompletedTurnTouchedFiles(transcript);

    expect(result.turn?.turnId).toBe("turn-1");
    expect(result.files).toMatchObject([{
      path: "src/new.ts",
      oldPath: "src/old.ts",
      displayPath: "src/old.ts -> src/new.ts",
      operation: "move",
    }]);
  });

  it("keeps only top-level visible file changes and dedupes by final path", () => {
    const transcript = transcriptWithTurns([{
      turnId: "turn-1",
      completedAt: "2026-04-04T00:00:30Z",
      items: [
        toolItem("tool-1", "turn-1", "src/app.ts"),
        toolItem("tool-2", "turn-1", "src/app.ts"),
        toolItem("child-tool", "turn-1", "src/child.ts", null, "parent-tool"),
        toolItem("hidden", "turn-1", ".claude/worktrees/tmp/file.ts"),
      ],
    }]);

    const result = collectLatestCompletedTurnTouchedFiles(transcript);

    expect(result.files.map((file) => file.path)).toEqual(["src/app.ts"]);
  });

  it("projects recorded stats and ordered nonblank patches for every touched file", () => {
    const transcript = transcriptWithTurns([{
      turnId: "turn-1",
      completedAt: "2026-04-04T00:00:30Z",
      items: [
        toolItem("first", "turn-1", "src/app.ts", null, null, {
          additions: 2,
          deletions: 1,
          patch: "@@ -1 +1 @@\n-old\n+first",
        }),
        toolItem("blank", "turn-1", "src/app.ts", null, null, {
          additions: 3,
          deletions: 2,
          patch: "  \n",
        }),
        toolItem("second", "turn-1", "src/app.ts", null, null, {
          additions: 4,
          deletions: 3,
          patch: "@@ -4 +4 @@\n-before\n+second",
        }),
        toolItem("metadata", "turn-1", "src/metadata.ts", null, null, {
          additions: 7,
          deletions: 5,
          patch: null,
        }),
      ],
    }]);

    const result = collectLatestCompletedTurnTouchedFiles(transcript);

    expect(result.files).toMatchObject([
      {
        path: "src/app.ts",
        recordedAdditions: 9,
        recordedDeletions: 6,
        recordedPatch: "@@ -1 +1 @@\n-old\n+first\n@@ -4 +4 @@\n-before\n+second",
      },
      {
        path: "src/metadata.ts",
        recordedAdditions: 7,
        recordedDeletions: 5,
        recordedPatch: null,
      },
    ]);
  });
});

function transcriptWithTurns(input: Array<{
  turnId: string;
  completedAt: string | null;
  items: Array<Record<string, unknown>>;
}>): TranscriptState {
  const transcript = createTranscriptState("session-1");
  transcript.turnOrder = input.map((turn) => turn.turnId);
  transcript.turnsById = Object.fromEntries(input.map((turn) => [
    turn.turnId,
    {
      turnId: turn.turnId,
      itemOrder: turn.items.map((item) => String(item.itemId)),
      startedAt: "2026-04-04T00:00:00Z",
      completedAt: turn.completedAt,
      stopReason: turn.completedAt ? "end_turn" : null,
      fileBadges: [],
    },
  ]));
  transcript.itemsById = Object.fromEntries(input.flatMap((turn) =>
    turn.items.map((item) => [String(item.itemId), item])
  )) as unknown as TranscriptState["itemsById"];
  return transcript;
}

function toolItem(
  itemId: string,
  turnId: string,
  path: string,
  newPath: string | null = null,
  parentToolCallId: string | null = null,
  evidence: {
    additions?: number;
    deletions?: number;
    patch?: string | null;
  } = {},
) {
  return {
    itemId,
    turnId,
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
      operation: newPath ? "move" : "edit",
      path,
      workspacePath: path,
      newPath,
      newWorkspacePath: newPath,
      ...evidence,
    }],
  };
}
