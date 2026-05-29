import { describe, expect, it } from "vitest";
import { toolCallItem } from "@/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";
import {
  deriveSubagentMcpReceiptPresentation,
  formatSubagentHeaderVerb,
  formatSubagentMcpActionLabel,
  isSubagentProvisioningAction,
} from "@proliferate/product-domain/chats/subagents/subagent-tool-presentation";

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
    expect(isSubagentProvisioningAction({
      nativeToolName: "mcp__subagents__read_subagent_events",
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
      wakeScheduled: false,
      openSessionAllowed: true,
    });
  });

  it("uses a generic title when a receipt only has a raw subagent id", () => {
    const presentation = deriveSubagentMcpReceiptPresentation(toolCallItem({
      nativeToolName: "mcp__subagents__get_subagent_status",
      rawOutput: {
        subagentId: "subagent_abc123",
        status: "idle",
      },
    }));

    expect(presentation).toMatchObject({
      title: "Subagent",
      subagentId: "subagent_abc123",
      detailLabel: "Idle",
    });
  });

  it("derives read-event receipts with event counts", () => {
    const presentation = deriveSubagentMcpReceiptPresentation(toolCallItem({
      nativeToolName: "mcp__subagents__read_subagent_events",
      rawOutput: {
        label: "Runtime Server Survey",
        events: [{ id: "event-1" }, { id: "event-2" }],
      },
    }));

    expect(presentation).toMatchObject({
      action: "read",
      actionLabel: "Read subagent events",
      title: "Runtime Server Survey",
      detailLabel: "2 events",
    });
  });

  it("derives receipt output from JSON result text when raw output is absent", () => {
    const presentation = deriveSubagentMcpReceiptPresentation(toolCallItem({
      nativeToolName: "mcp__subagents__search_subagent_transcript",
      contentParts: [{
        type: "tool_result_text",
        text: JSON.stringify({
          label: "Runtime Server Survey",
          matches: [{ line: "first" }],
        }, null, 2),
      }],
    }));

    expect(presentation).toMatchObject({
      action: "search",
      title: "Runtime Server Survey",
      detailLabel: "1 match",
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
