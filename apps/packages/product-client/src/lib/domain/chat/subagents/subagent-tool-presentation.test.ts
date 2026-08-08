import { describe, expect, it } from "vitest";
import { toolCallItem } from "#product/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";
import {
  deriveSubagentMcpReceiptPresentation,
  formatSubagentHeaderVerb,
  formatSubagentMcpActionLabel,
  isSubagentProvisioningAction,
} from "#product/domain/chats/subagents/subagent-tool-presentation";

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

  it("treats the pre-agent-ops tool names as aliases of the renamed tools", () => {
    expect(isSubagentProvisioningAction({
      nativeToolName: "mcp__subagents__spawn_subagent",
    })).toBe(true);
    expect(formatSubagentMcpActionLabel("mcp__subagents__close_agent"))
      .toBe(formatSubagentMcpActionLabel("mcp__subagents__close_subagent"));
    expect(formatSubagentHeaderVerb({
      item: { nativeToolName: "mcp__subagents__close_agent" },
      executionState: "completed",
      isRunning: false,
    })).toBe("Agent closed");
  });

  it("names the peer agent ops tools instead of falling back to the creation verb", () => {
    expect(formatSubagentMcpActionLabel("mcp__subagents__send_agent_message"))
      .toBe("Sent agent message");
    expect(formatSubagentMcpActionLabel("mcp__subagents__list_agents"))
      .toBe("Listed agents");
    expect(formatSubagentMcpActionLabel("mcp__subagents__read_agent_transcript"))
      .toBe("Read agent transcript");
    expect(formatSubagentMcpActionLabel("mcp__subagents__schedule_agent_wake"))
      .toBe("Scheduled agent wake");
    expect(formatSubagentMcpActionLabel("mcp__subagents__get_agent_config_options"))
      .toBe("Read agent config options");
    expect(formatSubagentMcpActionLabel("mcp__subagents__configure_agent"))
      .toBe("Configured agent");

    expect(formatSubagentHeaderVerb({
      item: { nativeToolName: "mcp__subagents__send_agent_message" },
      executionState: "completed",
      isRunning: false,
    })).toBe("Message sent to agent");
    expect(formatSubagentHeaderVerb({
      item: { nativeToolName: "mcp__subagents__read_agent_transcript" },
      executionState: "running",
      isRunning: true,
    })).toBe("Reading agent transcript");
    expect(formatSubagentHeaderVerb({
      item: { nativeToolName: "mcp__subagents__schedule_agent_wake" },
      executionState: "completed",
      isRunning: false,
    })).toBe("Agent wake scheduled");
    expect(formatSubagentHeaderVerb({
      item: { nativeToolName: "mcp__subagents__configure_agent" },
      executionState: "running",
      isRunning: true,
    })).toBe("Configuring agent");
    expect(formatSubagentHeaderVerb({
      item: { nativeToolName: "mcp__subagents__get_agent_config_options" },
      executionState: "completed",
      isRunning: false,
    })).toBe("Agent config options read");
    expect(formatSubagentMcpActionLabel("mcp__subagents__promote_subagent"))
      .toBe("Promoted subagent");
    expect(formatSubagentHeaderVerb({
      item: { nativeToolName: "mcp__subagents__promote_subagent" },
      executionState: "running",
      isRunning: true,
    })).toBe("Promoting subagent");
    expect(formatSubagentHeaderVerb({
      item: { nativeToolName: "mcp__subagents__promote_subagent" },
      executionState: "completed",
      isRunning: false,
    })).toBe("Subagent promoted");
  });

  it("reads a peer spawn as a spawn without calling the new agent a subagent", () => {
    expect(formatSubagentMcpActionLabel("mcp__subagents__spawn_agent"))
      .toBe("Spawned agent");
    expect(formatSubagentHeaderVerb({
      item: { nativeToolName: "mcp__subagents__spawn_agent" },
      executionState: "running",
      isRunning: true,
    })).toBe("Spawning agent");
    // The fallback verb is "Subagent created", so an unclassified spawn_agent
    // would silently misreport a peer as somebody's subagent.
    expect(formatSubagentHeaderVerb({
      item: { nativeToolName: "mcp__subagents__spawn_agent" },
      executionState: "completed",
      isRunning: false,
    })).toBe("Agent spawned");
  });

  it("keeps a peer spawn out of the subagent launch ledger", () => {
    expect(isSubagentProvisioningAction({
      nativeToolName: "mcp__subagents__spawn_agent",
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
      actionLabel: "Closed agent",
      title: "API Surface Check",
      openSessionAllowed: false,
    });
  });

  it("reads a close of a working agent as a request, not a stop", () => {
    // The agent is mid-step: `close_agent` returned closeRequested, the row is
    // stamped, and the runtime closes it when the step ends. A receipt that
    // said "Closed" here would be claiming something that has not happened.
    const presentation = deriveSubagentMcpReceiptPresentation(toolCallItem({
      nativeToolName: "mcp__subagents__close_agent",
      rawOutput: {
        subagentId: "subagent_123",
        sessionLinkId: "link-123",
        sessionId: "child-123",
        label: "API Surface Check",
        closed: false,
        closeRequested: true,
        closeReason: "duplicate work",
      },
    }));

    expect(presentation).toMatchObject({
      action: "close",
      childSessionId: "child-123",
      detailLabel: "Finishing current step",
      openSessionAllowed: true,
    });
  });

  it("surfaces the close reason once the agent is actually closed", () => {
    const presentation = deriveSubagentMcpReceiptPresentation(toolCallItem({
      nativeToolName: "mcp__subagents__close_agent",
      rawOutput: {
        subagentId: "subagent_123",
        sessionLinkId: "link-123",
        sessionId: "child-123",
        label: "API Surface Check",
        closed: true,
        closeRequested: false,
        closedBySessionId: "ses_owner",
        closeReason: "duplicate work",
      },
    }));

    expect(presentation).toMatchObject({
      action: "close",
      detailLabel: "duplicate work",
      openSessionAllowed: false,
    });
  });

  it("derives promotion receipts as openable peer receipts", () => {
    const presentation = deriveSubagentMcpReceiptPresentation(toolCallItem({
      nativeToolName: "mcp__subagents__promote_subagent",
      rawOutput: {
        subagentId: "subagent_123",
        sessionLinkId: "link-123",
        sessionId: "child-123",
        label: "API Surface Check",
        promoted: true,
        alreadyPromoted: false,
      },
    }));

    expect(presentation).toMatchObject({
      action: "promote",
      actionLabel: "Promoted subagent",
      title: "API Surface Check",
      childSessionId: "child-123",
      detailLabel: "Now a peer",
      openSessionAllowed: true,
    });
  });
});
