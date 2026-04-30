import { describe, expect, it } from "vitest";
import { createTranscriptState } from "@anyharness/sdk";
import type { ToolCallItem } from "@anyharness/sdk";
import {
  buildTranscriptDisplayBlocks,
  buildTurnPresentation,
  formatCollapsedActionsSummary,
  summarizeCollapsedActions,
} from "@/lib/domain/chat/transcript-presentation";
import {
  assistantItem,
  bareNativeToolItem,
  parsedCommandItem,
  range,
  terminalCmdItem,
  terminalItem,
  thoughtItem,
  toolItem,
  turnRecord,
  userItem,
} from "@/lib/domain/chat/transcript-presentation-test-fixtures";

describe("buildTurnPresentation", () => {
  it("orders items by startedSeq before insertion order", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      earlier: assistantItem("earlier", "turn-1", 1),
      later: assistantItem("later", "turn-1", 2),
    };
    const turn = turnRecord(["later", "earlier"]);

    const presentation = buildTurnPresentation(turn, transcript);

    expect(presentation.rootIds).toEqual(["earlier", "later"]);
    expect(presentation.displayBlocks).toEqual([
      { kind: "item", itemId: "earlier" },
      { kind: "item", itemId: "later" },
    ]);
  });

  it("attaches children to subagent parents and keeps grouped tools standalone", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      user: userItem("user", "turn-1", 1),
      tool: toolItem("tool", "turn-1", 2, "subagent"),
      child: assistantItem("child", "turn-1", 3, "tool"),
      final: assistantItem("final", "turn-1", 4),
    };
    const turn = turnRecord(
      ["user", "tool", "child", "final"],
      "2026-04-04T00:00:10Z",
    );

    const presentation = buildTurnPresentation(turn, transcript);

    expect(presentation.rootIds).toEqual(["user", "tool", "final"]);
    expect(presentation.childrenByParentId.get("tool")).toEqual(["child"]);
    expect(presentation.finalAssistantItemId).toBe("final");
    expect(presentation.displayBlocks).toEqual([
      { kind: "item", itemId: "user" },
      { kind: "item", itemId: "tool" },
      { kind: "item", itemId: "final" },
    ]);
  });

  it("builds scoped subagent work blocks with the same grouping as top-level turns", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      agent: toolItem("agent", "turn-1", 1, "subagent", "in_progress"),
      read: {
        ...toolItem("read", "turn-1", 2, "file_read"),
        parentToolCallId: "agent",
      },
      search: {
        ...toolItem("search", "turn-1", 3, "search"),
        parentToolCallId: "agent",
      },
      command: {
        ...terminalItem("command", "turn-1", 4, "cargo test", "in_progress"),
        parentToolCallId: "agent",
      },
      nested: {
        ...toolItem("nested", "turn-1", 5, "subagent", "in_progress"),
        parentToolCallId: "agent",
      },
      nestedRead: {
        ...toolItem("nestedRead", "turn-1", 6, "file_read"),
        parentToolCallId: "nested",
      },
    };
    const childrenByParentId = new Map<string, string[]>([
      ["agent", ["read", "search", "command", "nested"]],
      ["nested", ["nestedRead"]],
    ]);

    expect(buildTranscriptDisplayBlocks({
      rootIds: childrenByParentId.get("agent") ?? [],
      transcript,
      childrenByParentId,
      isComplete: false,
    })).toEqual([
      { kind: "collapsed_actions", blockId: "read-search", itemIds: ["read", "search"] },
      { kind: "inline_tool", itemId: "command" },
      { kind: "item", itemId: "nested" },
    ]);
  });

  it("does not apply completed-history collapse inside scoped subagent work", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      agent: toolItem("agent", "turn-1", 1, "subagent"),
      command: {
        ...terminalItem("command", "turn-1", 2, "cargo test"),
        parentToolCallId: "agent",
      },
      final: assistantItem("final", "turn-1", 3, "agent"),
    };
    const childrenByParentId = new Map<string, string[]>([
      ["agent", ["command", "final"]],
    ]);

    expect(buildTranscriptDisplayBlocks({
      rootIds: childrenByParentId.get("agent") ?? [],
      transcript,
      childrenByParentId,
      isComplete: true,
    })).toEqual([
      { kind: "collapsed_actions", blockId: "command-command", itemIds: ["command"] },
      { kind: "item", itemId: "final" },
    ]);
  });

  it("keeps background-running scoped subagent work in live presentation mode", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      agent: toolItem("agent", "turn-1", 1, "subagent", "completed"),
      cargo: {
        ...terminalItem("cargo", "turn-1", 2, "cargo test", "completed"),
        parentToolCallId: "agent",
      },
      read: {
        ...toolItem("read", "turn-1", 3, "file_read", "in_progress"),
        parentToolCallId: "agent",
      },
    };
    const childrenByParentId = new Map<string, string[]>([
      ["agent", ["cargo", "read"]],
    ]);

    expect(buildTranscriptDisplayBlocks({
      rootIds: childrenByParentId.get("agent") ?? [],
      transcript,
      childrenByParentId,
      isComplete: false,
    })).toEqual([
      { kind: "collapsed_actions", blockId: "cargo-read", itemIds: ["cargo", "read"] },
    ]);
  });

  it("does not force normal tool calls with children through grouped card presentation", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      command: terminalItem("command", "turn-1", 1, "cargo test"),
      child: assistantItem("child", "turn-1", 2, "command"),
      final: assistantItem("final", "turn-1", 3),
    };
    const turn = turnRecord(["command", "child", "final"]);

    const presentation = buildTurnPresentation(turn, transcript);

    expect(presentation.rootIds).toEqual(["command", "child", "final"]);
    expect(presentation.childrenByParentId.get("command")).toBeUndefined();
    expect(presentation.displayBlocks).toEqual([
      { kind: "collapsed_actions", blockId: "command-command", itemIds: ["command"] },
      { kind: "item", itemId: "child" },
      { kind: "item", itemId: "final" },
    ]);
  });

  it("builds completed work history before the final assistant message", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      user: userItem("user", "turn-1", 1),
      read: toolItem("read", "turn-1", 2, "file_read"),
      draft: assistantItem("draft", "turn-1", 3),
      final: assistantItem("final", "turn-1", 4),
    };
    const turn = turnRecord(
      ["user", "read", "draft", "final"],
      "2026-04-04T00:00:10Z",
    );

    const presentation = buildTurnPresentation(turn, transcript);

    expect(presentation.finalAssistantItemId).toBe("final");
    expect(presentation.completedHistoryRootIds).toEqual(["read", "draft"]);
    expect(presentation.completedHistorySummary).toEqual({
      messages: 1,
      toolCalls: 1,
      subagents: 0,
    });
  });

  it("excludes transient thoughts from transcript presentation", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      status: thoughtItem("status", "turn-1", 1, true),
      assistant: assistantItem("assistant", "turn-1", 2),
    };
    const turn = turnRecord(["status", "assistant"]);

    const presentation = buildTurnPresentation(turn, transcript);

    expect(presentation.rootIds).toEqual(["assistant"]);
    expect(presentation.displayBlocks).toEqual([
      { kind: "item", itemId: "assistant" },
    ]);
  });

  it("keeps transient tool calls visible for active work history", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      status: thoughtItem("status", "turn-1", 1, true),
      read: {
        ...toolItem("read", "turn-1", 2, "file_read", "in_progress"),
        isTransient: true,
      },
    };
    const turn = turnRecord(["status", "read"]);

    const presentation = buildTurnPresentation(turn, transcript);

    expect(presentation.rootIds).toEqual(["read"]);
    expect(presentation.displayBlocks).toEqual([
      { kind: "collapsed_actions", blockId: "read-read", itemIds: ["read"] },
    ]);
  });

  it("treats bare active read starts as collapsed exploration", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      read: bareNativeToolItem("read", "turn-1", 1, "Read", "read", "in_progress"),
    };
    const turn = turnRecord(["read"]);

    const presentation = buildTurnPresentation(turn, transcript);

    expect(presentation.displayBlocks).toEqual([
      { kind: "collapsed_actions", blockId: "read-read", itemIds: ["read"] },
    ]);
    expect(formatCollapsedActionsSummary(
      summarizeCollapsedActions(["read"], transcript),
    )).toBe("Explored 1 file");
  });

  it("splits completed action groups around assistant prose", () => {
    const transcript = createTranscriptState("session-1");
    const before = [
      ...range(5, "read", (id, seq) => toolItem(id, "turn-1", seq, "file_read")),
      ...range(2, "grep", (id, seq) => toolItem(id, "turn-1", seq + 5, "search")),
      ...range(2, "edit", (id, seq) => toolItem(id, "turn-1", seq + 7, "file_change")),
    ];
    const after = [
      toolItem("read-after-1", "turn-1", 11, "file_read"),
      toolItem("read-after-2", "turn-1", 12, "file_read"),
      toolItem("command", "turn-1", 13, "terminal"),
      toolItem("edit-after", "turn-1", 14, "file_change"),
      toolItem("read-after-3", "turn-1", 15, "file_read"),
      toolItem("read-after-4", "turn-1", 16, "file_read"),
    ];
    transcript.itemsById = Object.fromEntries([
      ...before.map((item) => [item.itemId, item]),
      ["message", assistantItem("message", "turn-1", 10)],
      ...after.map((item) => [item.itemId, item]),
    ]);
    const turn = turnRecord([...before.map((item) => item.itemId), "message", ...after.map((item) => item.itemId)]);

    const presentation = buildTurnPresentation(turn, transcript);

    expect(presentation.displayBlocks).toEqual([
      {
        kind: "collapsed_actions",
        blockId: "read-1-edit-2",
        itemIds: ["read-1", "read-2", "read-3", "read-4", "read-5", "grep-1", "grep-2", "edit-1", "edit-2"],
      },
      { kind: "item", itemId: "message" },
      {
        kind: "collapsed_actions",
        blockId: "read-after-1-read-after-4",
        itemIds: ["read-after-1", "read-after-2", "command", "edit-after", "read-after-3", "read-after-4"],
      },
    ]);
    expect(formatCollapsedActionsSummary(
      summarizeCollapsedActions(["read-1", "read-2", "grep-1", "edit-1"], transcript),
    )).toBe("Explored 2 files, 1 search, edited 1 file");
  });

  it("renders active tools inline until they complete", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      read: toolItem("read", "turn-1", 1, "file_read"),
      command: terminalItem("command", "turn-1", 2, "cargo test", "in_progress"),
      edit: toolItem("edit", "turn-1", 3, "file_change", "in_progress"),
    };
    const turn = turnRecord(["read", "command", "edit"]);

    expect(buildTurnPresentation(turn, transcript).displayBlocks).toEqual([
      { kind: "collapsed_actions", blockId: "read-read", itemIds: ["read"] },
      { kind: "inline_tool", itemId: "command" },
      { kind: "inline_tool", itemId: "edit" },
    ]);

    transcript.itemsById.command = {
      ...transcript.itemsById.command as ToolCallItem,
      status: "completed",
    };
    transcript.itemsById.edit = {
      ...transcript.itemsById.edit as ToolCallItem,
      status: "failed",
    };

    expect(buildTurnPresentation(turn, transcript).displayBlocks).toEqual([
      { kind: "collapsed_actions", blockId: "read-read", itemIds: ["read"] },
      { kind: "inline_tool", itemId: "command" },
      { kind: "inline_tool", itemId: "edit" },
    ]);
  });

  it("keeps trailing completed real action runs inline until a boundary arrives", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      sqlite: terminalItem("sqlite", "turn-1", 1, "sqlite3 db.sqlite '.tables'"),
      ps: terminalItem("ps", "turn-1", 2, "ps -ef | rg anyharness"),
    };
    const turn = turnRecord(["sqlite", "ps"]);

    expect(buildTurnPresentation(turn, transcript).displayBlocks).toEqual([
      { kind: "inline_tool", itemId: "sqlite" },
      { kind: "inline_tool", itemId: "ps" },
    ]);

    transcript.itemsById.pending = terminalItem("pending", "turn-1", 3, undefined, "in_progress");
    turn.itemOrder = ["sqlite", "ps", "pending"];

    expect(buildTurnPresentation(turn, transcript).displayBlocks).toEqual([
      { kind: "inline_tool", itemId: "sqlite" },
      { kind: "inline_tool", itemId: "ps" },
      { kind: "inline_tool", itemId: "pending" },
    ]);

    transcript.itemsById.read = toolItem("read", "turn-1", 3, "file_read", "in_progress");
    turn.itemOrder = ["sqlite", "ps", "read"];

    expect(buildTurnPresentation(turn, transcript).displayBlocks).toEqual([
      {
        kind: "collapsed_actions",
        blockId: "sqlite-read",
        itemIds: ["sqlite", "ps", "read"],
      },
    ]);

    transcript.itemsById = {
      sqlite: terminalItem("sqlite", "turn-1", 1, "sqlite3 db.sqlite '.tables'"),
      ps: terminalItem("ps", "turn-1", 2, "ps -ef | rg anyharness"),
      message: assistantItem("message", "turn-1", 3),
    };
    turn.itemOrder = ["sqlite", "ps", "message"];

    expect(buildTurnPresentation(turn, transcript).displayBlocks).toEqual([
      {
        kind: "collapsed_actions",
        blockId: "sqlite-ps",
        itemIds: ["sqlite", "ps"],
      },
      { kind: "item", itemId: "message" },
    ]);
  });

  it("treats ls and find shell commands as quiet exploration", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      list: terminalItem("list", "turn-1", 1, "ls -la", "in_progress"),
      find: terminalItem("find", "turn-1", 2, "find . -name '*.ts'"),
      command: terminalItem("command", "turn-1", 3, "cargo test", "in_progress"),
    };
    const turn = turnRecord(["list", "find", "command"]);

    const presentation = buildTurnPresentation(turn, transcript);

    expect(presentation.displayBlocks).toEqual([
      { kind: "collapsed_actions", blockId: "list-find", itemIds: ["list", "find"] },
      { kind: "inline_tool", itemId: "command" },
    ]);
    expect(formatCollapsedActionsSummary(
      summarizeCollapsedActions(["list", "find"], transcript),
    )).toBe("Explored 1 listing, 1 search");
  });

  it("treats raw cmd grep and read shell commands as quiet exploration", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      grep: terminalCmdItem("grep", "turn-1", 1, "rg useEffect desktop/src -n", "in_progress"),
      read: terminalCmdItem(
        "read",
        "turn-1",
        2,
        "sed -n '1,80p' desktop/src/App.tsx",
        "completed",
      ),
      command: terminalCmdItem("command", "turn-1", 3, "cargo test", "in_progress"),
    };
    const turn = turnRecord(["grep", "read", "command"]);

    expect(buildTurnPresentation(turn, transcript).displayBlocks).toEqual([
      { kind: "collapsed_actions", blockId: "grep-read", itemIds: ["grep", "read"] },
      { kind: "inline_tool", itemId: "command" },
    ]);
    expect(formatCollapsedActionsSummary(
      summarizeCollapsedActions(["grep", "read"], transcript),
    )).toBe("Explored 1 file, 1 search");
  });

  it("keeps active terminal calls in a subtle inline row while command details stream in", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      command: terminalItem("command", "turn-1", 1, undefined, "in_progress"),
    };
    const turn = turnRecord(["command"]);

    expect(buildTurnPresentation(turn, transcript).displayBlocks).toEqual([
      { kind: "inline_tool", itemId: "command" },
    ]);

    transcript.itemsById.command = {
      ...transcript.itemsById.command as ToolCallItem,
      rawInput: { command: "find . -name '*.ts'" },
    };

    expect(buildTurnPresentation(turn, transcript).displayBlocks).toEqual([
      { kind: "collapsed_actions", blockId: "command-command", itemIds: ["command"] },
    ]);
    expect(formatCollapsedActionsSummary(
      summarizeCollapsedActions(["command"], transcript),
    )).toBe("Explored 1 search");

    transcript.itemsById.command = {
      ...transcript.itemsById.command as ToolCallItem,
      rawInput: { command: "ls -la" },
    };

    expect(buildTurnPresentation(turn, transcript).displayBlocks).toEqual([
      { kind: "collapsed_actions", blockId: "command-command", itemIds: ["command"] },
    ]);
    expect(formatCollapsedActionsSummary(
      summarizeCollapsedActions(["command"], transcript),
    )).toBe("Explored 1 listing");

    transcript.itemsById.command = {
      ...transcript.itemsById.command as ToolCallItem,
      rawInput: { command: "cargo test" },
    };

    expect(buildTurnPresentation(turn, transcript).displayBlocks).toEqual([
      { kind: "inline_tool", itemId: "command" },
    ]);
  });

  it("keeps completed terminal calls without commands in collapsed command history", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      command: terminalItem("command", "turn-1", 1),
    };
    const turn = turnRecord(["command"]);

    expect(buildTurnPresentation(turn, transcript).displayBlocks).toEqual([
      { kind: "collapsed_actions", blockId: "command-command", itemIds: ["command"] },
    ]);
    expect(formatCollapsedActionsSummary(
      summarizeCollapsedActions(["command"], transcript),
    )).toBe("Running 1 command");
  });

  it("shows active Codex parsed read and search batches as collapsed exploration", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      scan: parsedCommandItem("scan", "turn-1", 1, [
        {
          type: "read",
          cmd: "sed -n '1,200p' desktop/src/components/workspace/chat/transcript/MessageList.tsx",
          name: "MessageList.tsx",
          path: "desktop/src/components/workspace/chat/transcript/MessageList.tsx",
        },
        {
          type: "search",
          cmd: "rg useEffect desktop/src",
          query: "useEffect",
          path: "desktop/src",
        },
        {
          type: "search",
          cmd: "rg useStore desktop/src",
          query: "useStore",
          path: "desktop/src",
        },
      ]),
    };
    const turn = turnRecord(["scan"]);

    expect(buildTurnPresentation(turn, transcript).displayBlocks).toEqual([
      { kind: "collapsed_actions", blockId: "scan-scan", itemIds: ["scan"] },
    ]);
    expect(formatCollapsedActionsSummary(
      summarizeCollapsedActions(["scan"], transcript),
    )).toBe("Explored 1 file, 2 searches");
  });

  it("expands active Codex ops shell batches into read and search rows", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      scan: parsedCommandItem("scan", "turn-1", 1, [{
        type: "unknown",
        cmd: [
          "ops=(",
          "  'rg \"<button\" desktop/src/components -n'",
          "  'sed -n \"1,120p\" desktop/src/components/AppShell.tsx'",
          "  'rg \"useEffect\" desktop/src -n'",
          ")",
          "for cmd in \"${ops[@]}\"; do eval \"$cmd\"; done",
          "printf 'Completed %d desktop grep/read operations.\\n' \"${#ops[@]}\"",
        ].join("\n"),
      }]),
    };
    const turn = turnRecord(["scan"]);

    expect(buildTurnPresentation(turn, transcript).displayBlocks).toEqual([
      { kind: "collapsed_actions", blockId: "scan-scan", itemIds: ["scan"] },
    ]);
    expect(formatCollapsedActionsSummary(
      summarizeCollapsedActions(["scan"], transcript),
    )).toBe("Explored 1 file, 2 searches");
  });

  it("keeps active parsed real commands inline until an exploration boundary arrives", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      sqlite: parsedCommandItem("sqlite", "turn-1", 1, [
        { type: "command", cmd: "sqlite3 db.sqlite '.tables'" },
      ]),
      ps: parsedCommandItem("ps", "turn-1", 2, [
        { type: "command", cmd: "ps -ef | rg anyharness" },
      ]),
    };
    const turn = turnRecord(["sqlite", "ps"]);

    expect(buildTurnPresentation(turn, transcript).displayBlocks).toEqual([
      { kind: "inline_tool", itemId: "sqlite" },
      { kind: "inline_tool", itemId: "ps" },
    ]);

    transcript.itemsById.sqlite = parsedCommandItem("sqlite", "turn-1", 1, [
      { type: "command", cmd: "sqlite3 db.sqlite '.tables'" },
    ], "completed");
    transcript.itemsById.ps = parsedCommandItem("ps", "turn-1", 2, [
      { type: "command", cmd: "ps -ef | rg anyharness" },
    ], "completed");
    transcript.itemsById.read = parsedCommandItem("read", "turn-1", 3, [
      {
        type: "read",
        cmd: "sed -n '1,80p' desktop/src/App.tsx",
        name: "App.tsx",
        path: "desktop/src/App.tsx",
      },
    ]);
    turn.itemOrder = ["sqlite", "ps", "read"];

    expect(buildTurnPresentation(turn, transcript).displayBlocks).toEqual([
      {
        kind: "collapsed_actions",
        blockId: "sqlite-read",
        itemIds: ["sqlite", "ps", "read"],
      },
    ]);
    expect(formatCollapsedActionsSummary(
      summarizeCollapsedActions(["sqlite", "ps", "read"], transcript),
    )).toBe("Explored 1 file, running 2 commands");
  });
});
