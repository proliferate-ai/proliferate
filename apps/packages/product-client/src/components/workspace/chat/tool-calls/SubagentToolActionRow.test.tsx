// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SubagentToolActionRow } from "#product/components/workspace/chat/tool-calls/SubagentToolActionRow";
import type {
  SubagentMcpReceiptPresentation,
} from "#product/domain/chats/subagents/subagent-tool-presentation";

function presentation(
  overrides: Partial<SubagentMcpReceiptPresentation> = {},
): SubagentMcpReceiptPresentation {
  return {
    action: "agent_send",
    actionLabel: "Sent message to agent",
    chipVerb: "messaged",
    messageText: null,
    addressedById: false,
    workspaceId: null,
    title: "Port webhook tests to vitest",
    subagentId: null,
    sessionLinkId: "link-tests",
    childSessionId: "sess_c81d2f9a",
    statusLabel: "Working",
    detailLabel: null,
    wakeScheduled: false,
    openSessionAllowed: true,
    originLabel: "Agent",
    ...overrides,
  };
}

describe("SubagentToolActionRow", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders an outgoing receipt as chip-then-verb", () => {
    const { container } = render(
      <SubagentToolActionRow presentation={presentation()} status="completed" />,
    );

    const row = container.querySelector("[data-subagent-receipt]");
    // TO an agent leads with the chip; the quiet verb trails it.
    expect(row?.textContent).toBe("Port webhook tests to vitestmessaged");
    expect(container.querySelector("[data-agent-chip]")).toBeTruthy();
    // The old sentence receipt is gone — no "Sent message to agent" prose.
    expect(row?.textContent).not.toContain("Sent message to agent");
  });

  it("never gives the message body its own UI", () => {
    const { container } = render(
      <SubagentToolActionRow
        presentation={presentation({ messageText: "Quarantine flaky tests instead of deleting them." })}
        status="completed"
      />,
    );

    // The body is hover-only: it is not in the transcript row.
    expect(container.querySelector("[data-subagent-receipt]")?.textContent)
      .not.toContain("Quarantine flaky tests");
    expect(container.querySelector("[data-agent-message-body]")).toBeNull();
  });

  it("carries the mono short id when the target was addressed by id", () => {
    const { container } = render(
      <SubagentToolActionRow
        presentation={presentation({ sessionLinkId: null, addressedById: true })}
        status="completed"
      />,
    );

    expect(container.querySelector("[data-agent-chip] .font-mono")).toBeTruthy();
  });

  it("dims a landed close and keeps the chip", () => {
    const { container } = render(
      <SubagentToolActionRow
        presentation={presentation({
          action: "close",
          chipVerb: "closed — superseded by the schema audit",
          openSessionAllowed: false,
        })}
        status="completed"
      />,
    );

    const chip = container.querySelector("[data-agent-chip]");
    expect(chip?.className).toContain("bg-transparent");
    expect(container.textContent).toContain("closed — superseded by the schema audit");
  });
});
