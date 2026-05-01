import { describe, expect, it } from "vitest";

import type { TerminalRecord } from "../types/terminals.js";
import type { AnyHarnessTransport } from "./core.js";
import { TerminalsClient } from "./terminals.js";

function terminalResponse(overrides: Partial<TerminalRecord> = {}): TerminalRecord {
  return {
    id: "terminal-1",
    workspaceId: "workspace-1",
    title: "Terminal",
    purpose: "general",
    cwd: "/tmp/workspace",
    status: "running",
    createdAt: "2026-04-19T00:00:00.000Z",
    updatedAt: "2026-04-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("TerminalsClient.updateTitle", () => {
  it("patches the terminal title endpoint", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const transport = {
      patch: async (path: string, body: unknown) => {
        calls.push({ path, body });
        return terminalResponse({ title: "Dev server" });
      },
    } as unknown as AnyHarnessTransport;
    const client = new TerminalsClient(transport);

    const response = await client.updateTitle("terminal/1", { title: "Dev server" });

    expect(response.title).toBe("Dev server");
    expect(calls).toEqual([{
      path: "/v1/terminals/terminal%2F1/title",
      body: { title: "Dev server" },
    }]);
  });
});
