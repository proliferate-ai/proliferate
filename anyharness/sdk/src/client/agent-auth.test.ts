import { describe, expect, it } from "vitest";

import type { AnyHarnessTransport } from "./core.js";
import { AgentAuthClient } from "./agent-auth.js";

describe("AgentAuthClient.clearState", () => {
  it("deletes the persisted route state", async () => {
    const calls: string[] = [];
    const transport = {
      delete: async (path: string) => {
        calls.push(path);
      },
    } as unknown as AnyHarnessTransport;
    const client = new AgentAuthClient(transport);

    await client.clearState();

    expect(calls).toEqual(["/v1/agent-auth/state"]);
  });
});
