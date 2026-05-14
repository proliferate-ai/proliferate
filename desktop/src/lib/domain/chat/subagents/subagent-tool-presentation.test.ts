import { describe, expect, it } from "vitest";
import {
  formatSubagentHeaderVerb,
  formatSubagentMcpActionLabel,
  isSubagentProvisioningAction,
} from "@/lib/domain/chat/subagents/subagent-tool-presentation";

describe("subagent tool presentation", () => {
  it("formats MCP action labels outside transcript components", () => {
    expect(formatSubagentMcpActionLabel("mcp__subagents__send_subagent_message"))
      .toBe("Sent subagent message");
    expect(formatSubagentMcpActionLabel("unknown")).toBeNull();
  });

  it("formats transcript group headers by action and state", () => {
    expect(formatSubagentHeaderVerb({
      item: { nativeToolName: "mcp__subagents__search_subagent_transcript" },
      executionState: "completed",
      isRunning: false,
    })).toBe("Subagent transcript searched");
    expect(formatSubagentHeaderVerb({
      item: { nativeToolName: "mcp__subagents__search_subagent_transcript" },
      executionState: "running",
      isRunning: true,
    })).toBe("Searching subagent transcript");
  });

  it("keeps status, close, read, and search actions out of provisioning ledgers", () => {
    expect(isSubagentProvisioningAction({
      nativeToolName: "mcp__subagents__send_subagent_message",
    })).toBe(true);
    expect(isSubagentProvisioningAction({
      nativeToolName: "mcp__subagents__get_subagent_status",
    })).toBe(false);
    expect(isSubagentProvisioningAction({
      nativeToolName: "mcp__subagents__close_subagent",
    })).toBe(false);
    expect(isSubagentProvisioningAction({
      nativeToolName: "mcp__subagents__read_subagent_latest_turns",
    })).toBe(false);
  });
});
