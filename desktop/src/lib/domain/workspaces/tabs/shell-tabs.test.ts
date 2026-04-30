import { describe, expect, it } from "vitest";
import {
  chatWorkspaceShellTabKey,
  fileWorkspaceShellTabKey,
  getWorkspaceShellTabKey,
  orderWorkspaceShellTabs,
  partitionWorkspaceShellTabKeys,
  parseWorkspaceShellTabKey,
  resolveFallbackWorkspaceShellTab,
  sanitizeWorkspaceShellTabOrder,
  type WorkspaceShellTab,
} from "./shell-tabs";

describe("workspace shell tab keys", () => {
  it("parses file paths without splitting on later colons", () => {
    const key = fileWorkspaceShellTabKey("src/routes/http:debug.ts");

    expect(parseWorkspaceShellTabKey(key)).toEqual({
      kind: "file",
      path: "src/routes/http:debug.ts",
    });
  });

  it("round-trips chat keys", () => {
    const key = chatWorkspaceShellTabKey("session-1");

    expect(parseWorkspaceShellTabKey(key)).toEqual({
      kind: "chat",
      sessionId: "session-1",
    });
  });

  it("partitions mixed keys without splitting file path content", () => {
    expect(partitionWorkspaceShellTabKeys([
      chatWorkspaceShellTabKey("session-1"),
      fileWorkspaceShellTabKey("src/routes/http:debug.ts"),
      "unknown:key",
    ])).toEqual({
      chatSessionIds: ["session-1"],
      filePaths: ["src/routes/http:debug.ts"],
    });
  });
});

describe("workspace shell tab ordering", () => {
  const tabs: WorkspaceShellTab[] = [
    { kind: "chat", sessionId: "a" },
    { kind: "chat", sessionId: "b" },
    { kind: "file", path: "src/a.ts" },
  ];

  it("orders tabs from explicit shell keys and appends missing live tabs", () => {
    expect(orderWorkspaceShellTabs({
      tabs,
      orderKeys: [
        fileWorkspaceShellTabKey("src/a.ts"),
        chatWorkspaceShellTabKey("a"),
      ],
    })).toEqual([
      { kind: "file", path: "src/a.ts" },
      { kind: "chat", sessionId: "a" },
      { kind: "chat", sessionId: "b" },
    ]);
  });

  it("filters stale keys while preserving live mixed order", () => {
    expect(sanitizeWorkspaceShellTabOrder({
      liveTabs: tabs,
      orderKeys: [
        fileWorkspaceShellTabKey("deleted.ts"),
        chatWorkspaceShellTabKey("b"),
        fileWorkspaceShellTabKey("src/a.ts"),
      ],
    })).toEqual([
      chatWorkspaceShellTabKey("b"),
      fileWorkspaceShellTabKey("src/a.ts"),
      chatWorkspaceShellTabKey("a"),
    ]);
  });

  it("chooses a nearby fallback after closing active tabs", () => {
    const active = tabs[2];

    expect(resolveFallbackWorkspaceShellTab({
      tabs,
      activeTab: active,
      closingTabs: [active],
    })).toEqual({ kind: "chat", sessionId: "b" });
  });

  it("exposes stable keys for tab identities", () => {
    expect(getWorkspaceShellTabKey({ kind: "chat", sessionId: "a" }))
      .toBe(chatWorkspaceShellTabKey("a"));
    expect(getWorkspaceShellTabKey({ kind: "file", path: "src/a.ts" }))
      .toBe(fileWorkspaceShellTabKey("src/a.ts"));
  });
});
