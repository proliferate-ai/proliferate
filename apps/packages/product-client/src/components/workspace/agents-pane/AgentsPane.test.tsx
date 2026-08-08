// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentsPane } from "#product/components/workspace/agents-pane/AgentsPane";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import {
  toAgentsPaneAgent,
  type AgentsPaneAgent,
  type AgentsPaneAgentSource,
} from "#product/lib/domain/delegated-work/agents-pane-model";

function makeAgent(
  title: string,
  statusLabel: string,
  overrides: Partial<AgentsPaneAgentSource> = {},
): AgentsPaneAgent {
  const sessionLinkId = `link-${title.replace(/\s+/gu, "-").toLowerCase()}`;
  return toAgentsPaneAgent({
    sessionLinkId,
    childSessionId: `sess_${sessionLinkId}`,
    identity: buildDelegatedAgentIdentity({
      id: sessionLinkId,
      title,
      sessionId: `sess_${sessionLinkId}`,
      sessionLinkId,
    }),
    statusLabel,
    latestCompletionLabel: null,
    wakeScheduled: false,
    closeRequested: false,
    closeRequestedLabel: null,
    ownership: "subagent",
    workspaceId: null,
    ...overrides,
  });
}

const audit = makeAgent("Audit retry queue schema", "Working");
const docs = makeAgent("Docs pass on retry semantics", "Idle");
const spike = makeAgent("Spike: idempotency keys", "Closed");

const clusters = [{
  sessionId: "s1",
  title: "Refactor billing webhooks",
  agents: [audit, docs, spike],
}];

const noop = () => {};

function renderPane(props: Partial<Parameters<typeof AgentsPane>[0]> = {}) {
  return render(
    <AgentsPane
      view={{ kind: "overview" }}
      clusters={clusters}
      onOpenCluster={noop}
      onOpenAgent={noop}
      onBack={noop}
      onOpenSession={noop}
      onPromote={noop}
      onClose={noop}
      onSend={noop}
      {...props}
    />,
  );
}

describe("AgentsPane", () => {
  afterEach(() => {
    cleanup();
  });

  it("level 1 lists delegating sessions with a live summary and a glyph stack", () => {
    const onOpenCluster = vi.fn();
    const { container } = renderPane({ onOpenCluster });

    expect(container.textContent).toContain("1 session delegating · 2 agents");
    expect(container.textContent).toContain("Refactor billing webhooks");
    expect(container.textContent).toContain("1 working · 1 idle");
    // The closed agent is not on the stack — only live agents are.
    expect(container.querySelectorAll("[data-agents-pane-overview] svg")).toHaveLength(3);
    // No back arrow at the floor of the drill.
    expect(screen.queryByLabelText("Back to all agents")).toBeNull();

    fireEvent.click(screen.getByText("Refactor billing webhooks"));
    expect(onOpenCluster).toHaveBeenCalledWith("s1");
  });

  it("level 2 partitions the cluster and drills into an agent", () => {
    const onOpenAgent = vi.fn();
    const { container } = renderPane({
      view: { kind: "cluster", sessionId: "s1" },
      onOpenAgent,
    });

    expect([...container.querySelectorAll("h2")].map((node) => node.textContent))
      .toEqual(["Working", "Idle", "Closed"]);
    expect(screen.getByLabelText("Back to all agents")).toBeTruthy();

    fireEvent.click(screen.getByText("Docs pass on retry semantics"));
    expect(onOpenAgent).toHaveBeenCalledWith("s1", docs.sessionLinkId);
  });

  it("closes an idle agent instantly and asks before ending work in flight", () => {
    const onClose = vi.fn();
    renderPane({ view: { kind: "cluster", sessionId: "s1" }, onClose });

    fireEvent.click(screen.getByLabelText("Close Docs pass on retry semantics"));
    expect(onClose).toHaveBeenCalledWith(docs);
    expect(screen.queryByText(/mid-turn/u)).toBeNull();

    onClose.mockClear();
    fireEvent.click(screen.getByLabelText("Close Audit retry queue schema"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Close "Audit retry queue schema"?')).toBeTruthy();
    expect(screen.getByText(
      "It's mid-turn — it will finish the current step, then stop. "
      + "The transcript stays readable under Closed.",
    )).toBeTruthy();
    // Calm, not alarmed: the affirmative action is the primary button, and
    // nothing on the confirm is destructive-styled.
    const confirm = document.querySelector("[data-agents-pane-confirm]");
    expect(confirm?.innerHTML).not.toContain("bg-destructive");

    fireEvent.click(screen.getByText("Close agent"));
    expect(onClose).toHaveBeenCalledWith(audit);
  });

  it("offers no close on an agent that is already closed", () => {
    renderPane({ view: { kind: "cluster", sessionId: "s1" } });

    expect(screen.queryByLabelText("Close Spike: idempotency keys")).toBeNull();
  });

  it("level 3 promotes behind one confirm carrying the ADR's sentence", () => {
    const onPromote = vi.fn();
    renderPane({
      view: { kind: "agent", sessionId: "s1", sessionLinkId: audit.sessionLinkId },
      onPromote,
    });

    fireEvent.click(screen.getByText("Promote"));
    expect(onPromote).not.toHaveBeenCalled();
    expect(screen.getByText('Promote "Audit retry queue schema"?')).toBeTruthy();
    expect(screen.getByText(
      "It becomes a top-level session in this workspace's tabs, keeps its transcript, "
      + "and can spawn its own subagents.",
    )).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    expect(onPromote).toHaveBeenCalledWith(audit);
  });

  it("level 3 carries the copyable short id, the read-model facts, and the messaging composer", () => {
    const onSend = vi.fn();
    const { container } = render(
      <AgentsPane
        view={{ kind: "agent", sessionId: "s1", sessionLinkId: docs.sessionLinkId }}
        clusters={clusters}
        onOpenCluster={noop}
        onOpenAgent={noop}
        onBack={noop}
        onOpenSession={noop}
        onPromote={noop}
        onClose={noop}
        onSend={onSend}
      />,
    );

    expect(screen.getByLabelText(`Copy session id ${docs.identity.shortId}`)).toBeTruthy();
    expect(container.textContent).toContain("Parent prompt");
    expect(container.textContent).toContain("Open as tab");

    const composer = screen.getByLabelText("Message this agent — delivered on its next turn");
    fireEvent.change(composer, { target: { value: "Ship the cap as configurable." } });
    fireEvent.click(screen.getByText("Send"));
    expect(onSend).toHaveBeenCalledWith(docs, "Ship the cap as configurable.");
  });

  it("shows the wake toggle disabled, because only agents can arm a wake on reply", () => {
    const { container } = renderPane({
      view: { kind: "agent", sessionId: "s1", sessionLinkId: docs.sessionLinkId },
    });

    const toggle = container.querySelector("[data-agents-pane-wake-toggle]");
    expect(toggle?.textContent).toBe("Wake me on reply");
    expect(toggle?.getAttribute("disabled")).not.toBeNull();
  });

  it("gives a closed agent a read-only detail: no actions, no composer", () => {
    const { container } = renderPane({
      view: { kind: "agent", sessionId: "s1", sessionLinkId: spike.sessionLinkId },
      closeAttributionFor: () => "Closed by Refactor billing webhooks · superseded",
    });

    expect(container.textContent).toContain("Closed · transcript is read-only");
    expect(container.textContent).toContain("Closed by Refactor billing webhooks · superseded");
    expect(screen.queryByText("Promote")).toBeNull();
    expect(screen.queryByText("Close")).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
  });
});
