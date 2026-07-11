import { describe, expect, it } from "vitest";
import { createTranscriptState, type ToolCallItem } from "@anyharness/sdk";
import {
  classifyCollapsedAction,
  formatCollapsedActionsSummary,
  resolveCurrentCollapsedAction,
  summarizeCollapsedActions,
} from "./transcript-collapsed-actions";
import {
  getToolCallParsedCommands,
  getToolCallShellCommand,
  getToolCallShellCommandName,
} from "./transcript-tool-commands";
import {
  bareNativeToolItem,
  parsedCommandItem,
  terminalItem,
  toolItem,
} from "./transcript-presentation-test-fixtures";

describe("transcript actions", () => {
  it("resolves one current action instead of a cumulative live count", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      command: terminalItem("command", "turn-1", 1, "pnpm test", "completed"),
      read: toolItem("read", "turn-1", 2, "file_read", "in_progress"),
    };

    expect(resolveCurrentCollapsedAction(["command", "read"], transcript)).toEqual({
      itemId: "read",
      kind: "read",
      label: "Reading read.ts",
    });
  });

  it("does not invent per-operation progress for a parsed command batch", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      batch: parsedCommandItem("batch", "turn-1", 1, [
        { type: "read", cmd: "cat first.ts", path: "first.ts" },
        { type: "read", cmd: "cat second.ts", path: "second.ts" },
      ]),
    };

    expect(resolveCurrentCollapsedAction(["batch"], transcript)).toEqual({
      itemId: "batch",
      kind: "command",
      label: "Running command",
    });
  });

  it("classifies representative tool calls for collapsed action grouping", () => {
    expect(classifyCollapsedAction(toolItem("read", "turn-1", 1, "file_read"))).toBe("read");
    expect(classifyCollapsedAction(toolItem("edit", "turn-1", 2, "file_change"))).toBe("edit");
    expect(classifyCollapsedAction(toolItem("search", "turn-1", 3, "search"))).toBe("search");
    expect(classifyCollapsedAction(toolItem("fetch", "turn-1", 4, "fetch"))).toBe("fetch");
    expect(classifyCollapsedAction(bareNativeToolItem("list", "turn-1", 5, "LS", "list"))).toBe("listing");
    expect(classifyCollapsedAction(terminalItem("test", "turn-1", 6, "pnpm test"))).toBe("command");
  });

  it("treats mixed parsed exploration and real commands as visible action work", () => {
    const mixed = parsedCommandItem("mixed", "turn-1", 1, [
      {
        type: "read",
        cmd: "sed -n '1,80p' apps/desktop/src/App.tsx",
        path: "apps/desktop/src/App.tsx",
      },
      {
        type: "command",
        cmd: "pnpm test",
      },
    ]);
    const commandOnly = parsedCommandItem("command", "turn-1", 2, [
      {
        type: "command",
        cmd: "pnpm test",
      },
    ]);

    expect(classifyCollapsedAction(mixed)).toBe("action");
    expect(classifyCollapsedAction(commandOnly)).toBe("command");
  });

  it("extracts shell commands and display command names from raw input variants", () => {
    const arrayCommand = {
      ...terminalItem("array", "turn-1", 1),
      rawInput: {
        command: ["/bin/zsh", "-lc", "cd /repo && pnpm test"],
      },
    } satisfies ToolCallItem;
    const cmdCommand = {
      ...terminalItem("cmd", "turn-1", 2),
      rawInput: {
        cmd: "rg useEffect apps/desktop/src -n",
      },
    } satisfies ToolCallItem;

    expect(getToolCallShellCommand(arrayCommand)).toBe("cd /repo && pnpm test");
    expect(getToolCallShellCommandName(arrayCommand)).toBe("pnpm");
    expect(getToolCallShellCommand(cmdCommand)).toBe("rg useEffect apps/desktop/src -n");
    expect(getToolCallShellCommandName(cmdCommand)).toBe("rg");
  });

  it("falls back to retained shell titles when raw command input is stripped", () => {
    const retainedTitleCommand = {
      ...terminalItem("retained-title", "turn-1", 1),
      title: "pnpm test -- --runInBand",
      rawInput: {
        reason: "raw tool bodies are not retained in cloud event sync",
        retention: "stripped",
      },
      contentParts: [
        {
          type: "tool_call",
          toolCallId: "retained-title",
          title: "pnpm test -- --runInBand",
          toolKind: "execute",
          nativeToolName: "Bash",
        },
      ],
    } satisfies ToolCallItem;
    const genericTitleCommand = {
      ...terminalItem("generic-title", "turn-1", 2),
      title: "Terminal",
      rawInput: {
        reason: "raw tool bodies are not retained in cloud event sync",
        retention: "stripped",
      },
      contentParts: [
        {
          type: "tool_call",
          toolCallId: "generic-title",
          title: "Terminal",
          toolKind: "execute",
          nativeToolName: "Bash",
        },
      ],
    } satisfies ToolCallItem;

    expect(getToolCallShellCommand(retainedTitleCommand)).toBe("pnpm test -- --runInBand");
    expect(getToolCallShellCommandName(retainedTitleCommand)).toBe("pnpm");
    expect(getToolCallShellCommand(genericTitleCommand)).toBeNull();
  });

  it("expands parsed operation batches into normalized command metadata", () => {
    const item = parsedCommandItem("scan", "turn-1", 1, [{
      type: "unknown",
      cmd: [
        "ops=(",
        "  'rg \"useEffect\" apps/desktop/src -n'",
        "  'sed -n \"1,120p\" apps/desktop/src/App.tsx'",
        "  'curl https://example.test/feed.json'",
        ")",
        "for cmd in \"${ops[@]}\"; do eval \"$cmd\"; done",
      ].join("\n"),
    }]);

    expect(getToolCallParsedCommands(item)).toEqual([
      {
        kind: "search",
        command: "rg \"useEffect\" apps/desktop/src -n",
        path: "apps/desktop/src",
        name: "src",
        query: "useEffect",
      },
      {
        kind: "read",
        command: "sed -n \"1,120p\" apps/desktop/src/App.tsx",
        path: "apps/desktop/src/App.tsx",
        name: "App.tsx",
        query: null,
      },
      {
        kind: "fetch",
        command: "curl https://example.test/feed.json",
        path: null,
        name: null,
        query: null,
      },
    ]);
  });

  it("summarizes and formats collapsed action copy from transcript items", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      read: toolItem("read", "turn-1", 1, "file_read"),
      list: bareNativeToolItem("list", "turn-1", 2, "LS", "list"),
      grep: terminalItem("grep", "turn-1", 3, "rg useEffect apps/desktop/src -n"),
      fetch: terminalItem("fetch", "turn-1", 4, "curl https://example.test/feed.json"),
      command: terminalItem("command", "turn-1", 5, "pnpm test"),
      edit: toolItem("edit", "turn-1", 6, "file_change"),
      action: parsedCommandItem("action", "turn-1", 7, [
        {
          type: "read",
          cmd: "sed -n '1,80p' apps/desktop/src/App.tsx",
        },
        {
          type: "command",
          cmd: "pnpm lint",
        },
      ]),
    };

    const summary = summarizeCollapsedActions([
      "read",
      "list",
      "grep",
      "fetch",
      "command",
      "edit",
      "action",
      "missing",
    ], transcript);

    expect(summary).toEqual({
      reads: 2,
      listings: 1,
      searches: 1,
      fetches: 1,
      commands: 2,
      edits: 1,
      actions: 0,
    });
    expect(formatCollapsedActionsSummary(summary)).toBe(
      "Explored 2 files, 1 listing, 1 search, 1 fetch, ran 2 commands, edited 1 file",
    );
    expect(formatCollapsedActionsSummary({
      reads: 0,
      listings: 0,
      searches: 0,
      fetches: 0,
      commands: 0,
      edits: 0,
      actions: 0,
    })).toBe("Working");
  });
});
