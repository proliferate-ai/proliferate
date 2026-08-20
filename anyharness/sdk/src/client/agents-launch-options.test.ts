import { describe, expect, it } from "vitest";
import type { AnyHarnessTransport } from "./core.js";
import { AgentsClient } from "./agents.js";

describe("AgentsClient launch options", () => {
  it("reads the target-observed harness route with an encoded kind", async () => {
    const calls: string[] = [];
    const transport = {
      get: async (path: string) => { calls.push(path); return {}; },
    } as unknown as AnyHarnessTransport;
    await new AgentsClient(transport).getLaunchOptions("agent/kind");
    expect(calls).toEqual(["/v1/agents/agent%2Fkind/launch-options"]);
  });

  it("requests an override-free refresh on the same harness route", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const transport = {
      post: async (path: string, body: unknown) => { calls.push({ path, body }); return {}; },
    } as unknown as AnyHarnessTransport;
    await new AgentsClient(transport).refreshLaunchOptions("codex");
    expect(calls).toEqual([{
      path: "/v1/agents/codex/launch-options/refresh",
      body: {},
    }]);
  });
});
