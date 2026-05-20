import { describe, expect, it } from "vitest";
import { toolCallItem } from "@/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";
import {
  deriveSubagentMcpReceiptPresentation,
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
      nativeToolName: "mcp__subagents__create_subagent",
    })).toBe(true);
    expect(isSubagentProvisioningAction({
      nativeToolName: "mcp__subagents__send_subagent_message",
    })).toBe(false);
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

  it("derives concise status receipt presentation with the child target", () => {
    const presentation = deriveSubagentMcpReceiptPresentation(toolCallItem({
      nativeToolName: "mcp__subagents__get_subagent_status",
      rawInput: { subagentId: "subagent_123" },
      rawOutput: {
        subagentId: "subagent_123",
        sessionLinkId: "link-123",
        childSessionId: "child-123",
        label: "API Surface Check",
        status: "running",
      },
    }));

    expect(presentation).toMatchObject({
      action: "status",
      actionLabel: "Checked subagent",
      title: "API Surface Check",
      subagentId: "subagent_123",
      sessionLinkId: "link-123",
      childSessionId: "child-123",
      detailLabel: "Working",
      openSessionAllowed: true,
    });
  });

  it("derives close receipts as non-openable agent receipts", () => {
    const presentation = deriveSubagentMcpReceiptPresentation(toolCallItem({
      nativeToolName: "mcp__subagents__close_subagent",
      rawOutput: {
        subagentId: "subagent_123",
        sessionLinkId: "link-123",
        childSessionId: "child-123",
        label: "API Surface Check",
        closed: true,
      },
    }));

    expect(presentation).toMatchObject({
      action: "close",
      actionLabel: "Closed subagent",
      title: "API Surface Check",
      openSessionAllowed: false,
    });
  });
});
