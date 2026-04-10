import { describe, expect, it } from "vitest";
import { parseToolBackgroundWork } from "./background-work.js";

describe("parseToolBackgroundWork", () => {
  it("parses structured background work metadata from raw output", () => {
    expect(
      parseToolBackgroundWork({
        isAsync: true,
        agentId: "agent-1",
        outputFile: "/tmp/agent.output",
        _anyharness: {
          backgroundWork: {
            trackerKind: "claude_async_agent",
            state: "pending",
          },
        },
      }),
    ).toEqual({
      trackerKind: "claude_async_agent",
      state: "pending",
      isAsync: true,
      agentId: "agent-1",
      outputFile: "/tmp/agent.output",
    });
  });

  it("returns null for non-background raw output", () => {
    expect(parseToolBackgroundWork({ stdout: "hello" })).toBeNull();
  });
});
