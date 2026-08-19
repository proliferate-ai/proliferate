import { describe, expect, it } from "vitest";
import { reduceEvents } from "../../index.js";
import type {
  ContentPart,
  SessionEventEnvelope,
  ToolCallItem,
} from "../../index.js";

describe("file-change path presence", () => {
  it("keeps identity stable when a workspace path becomes empty", () => {
    const state = reduceFileChangeSnapshots(
      [fileChange({ path: "/wire/src/app.ts", workspacePath: "src/app.ts" })],
      [fileChange({ path: "/wire/src/app.ts", workspacePath: "" })],
    );

    const fileChanges = changes(state.itemsById["tool-1"] as ToolCallItem);
    expect(fileChanges).toHaveLength(1);
    expect(fileChanges[0]).toMatchObject({
      path: "/wire/src/app.ts",
      workspacePath: "",
    });
  });

  it("keeps identity stable when a new workspace path becomes whitespace", () => {
    const state = reduceFileChangeSnapshots(
      [fileChange({
        operation: "move",
        path: "/wire/src/old.ts",
        workspacePath: "src/old.ts",
        newPath: "/wire/src/new.ts",
        newWorkspacePath: "src/new.ts",
      })],
      [fileChange({
        operation: "move",
        path: "/wire/src/old.ts",
        workspacePath: "src/old.ts",
        newPath: "/wire/src/new.ts",
        newWorkspacePath: "  ",
      })],
    );

    const fileChanges = changes(state.itemsById["tool-1"] as ToolCallItem);
    expect(fileChanges).toHaveLength(1);
    expect(fileChanges[0]).toMatchObject({
      newPath: "/wire/src/new.ts",
      newWorkspacePath: "  ",
    });
  });

  it("keeps different raw wire paths distinct despite shared structured paths", () => {
    const state = reduceFileChangeSnapshots(
      [fileChange({ path: "/wire/src/first.ts", workspacePath: "src/shared.ts" })],
      [fileChange({ path: "/wire/src/second.ts", workspacePath: "src/shared.ts" })],
    );

    const fileChanges = changes(state.itemsById["tool-1"] as ToolCallItem);
    expect(fileChanges).toHaveLength(2);
    expect(fileChanges.map((part) => part.path)).toEqual(expect.arrayContaining([
      "/wire/src/first.ts",
      "/wire/src/second.ts",
    ]));
  });
});

type FileChange = Extract<ContentPart, { type: "file_change" }>;

function fileChange(
  fields: Pick<FileChange, "path"> & Partial<Omit<FileChange, "type" | "path">>,
): FileChange {
  return { type: "file_change", operation: "edit", ...fields };
}

function changes(item: ToolCallItem): FileChange[] {
  return item.contentParts.filter((part): part is FileChange => part.type === "file_change");
}

function reduceFileChangeSnapshots(initial: FileChange[], next: FileChange[]) {
  const toolCallPart: Extract<ContentPart, { type: "tool_call" }> = {
    type: "tool_call",
    toolCallId: "tool-1",
    title: "Edit file",
    toolKind: "edit",
  };
  const events: SessionEventEnvelope[] = [
    {
      sessionId: "session-1",
      seq: 1,
      timestamp: "2026-04-04T00:00:01Z",
      turnId: "turn-1",
      event: { type: "turn_started" },
    },
    {
      sessionId: "session-1",
      seq: 2,
      timestamp: "2026-04-04T00:00:02Z",
      turnId: "turn-1",
      itemId: "tool-1",
      event: {
        type: "item_started",
        item: {
          kind: "tool_invocation",
          status: "in_progress",
          sourceAgentKind: "claude",
          toolCallId: "tool-1",
          title: "Edit file",
          contentParts: [toolCallPart, ...initial],
        },
      },
    },
    {
      sessionId: "session-1",
      seq: 3,
      timestamp: "2026-04-04T00:00:03Z",
      turnId: "turn-1",
      itemId: "tool-1",
      event: {
        type: "item_delta",
        delta: { replaceContentParts: [toolCallPart, ...next] },
      },
    },
  ];
  return reduceEvents(events, "session-1");
}
