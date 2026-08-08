import { describe, expect, it } from "vitest";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import {
  AGENTS_PANE_CLOSE_CONFIRM_BODY,
  AGENTS_PANE_PROMOTE_CONFIRM_BODY,
  AGENTS_PANE_PROMOTED_BADGE,
  agentsPaneCanClose,
  agentsPaneCanPromote,
  agentsPaneCloseAttribution,
  agentsPaneCloseAttributionForAgent,
  agentsPaneCloseNeedsConfirm,
  agentsPaneClusterSummary,
  agentsPaneDetailEntries,
  agentsPaneOverviewSummary,
  agentsPaneStack,
  agentsPaneStatusLine,
  buildAgentsPaneClusters,
  partitionAgentsPaneSections,
  toAgentsPaneAgent,
  type AgentsPaneAgentSource,
} from "#product/lib/domain/delegated-work/agents-pane-model";

function source(
  title: string,
  statusLabel: string,
  overrides: Partial<AgentsPaneAgentSource> = {},
): AgentsPaneAgentSource {
  const sessionLinkId = `link-${title.replace(/\s+/gu, "-").toLowerCase()}`;
  return {
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
    closedBySessionId: null,
    closeReason: null,
    ownership: "subagent",
    workspaceId: null,
    ...overrides,
  };
}

function agent(...args: Parameters<typeof source>) {
  return toAgentsPaneAgent(source(...args));
}

describe("agents pane sections", () => {
  it("splits a cluster into Working / Idle / Done / Closed, in that order", () => {
    const sections = partitionAgentsPaneSections([
      agent("Spike: idempotency keys", "Closed"),
      agent("Port webhook tests", "Done"),
      agent("Docs pass", "Idle"),
      agent("Audit retry queue schema", "Working"),
      agent("Bisect the GC regression", "Failed"),
      agent("Boot the crawler", "Starting"),
    ]);

    expect(sections.map((section) => section.title))
      .toEqual(["Working", "Idle", "Done", "Closed"]);
    // Starting is work about to happen, and a failed turn is a finished one.
    expect(sections[0].agents.map((entry) => entry.identity.title))
      .toEqual(["Audit retry queue schema", "Boot the crawler"]);
    expect(sections[2].agents.map((entry) => entry.identity.title))
      .toEqual(["Port webhook tests", "Bisect the GC regression"]);
  });

  it("renders no heading for a section with nothing in it", () => {
    const sections = partitionAgentsPaneSections([agent("Audit retry queue schema", "Working")]);

    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe("working");
  });

  it("keeps an agent that was asked to close under Working until it stops", () => {
    const closing = agent("Audit retry queue schema", "Working", {
      closeRequested: true,
      closeRequestedLabel: "Closing · superseded",
    });

    expect(closing.section).toBe("working");
    expect(closing.statusLine).toBe("Closing · superseded");
  });
});

describe("agents pane summaries", () => {
  it("caps a cluster as 'N working · N idle · N done'", () => {
    expect(agentsPaneClusterSummary([
      agent("Audit retry queue schema", "Working"),
      agent("Repro flaky cleanup", "Working"),
      agent("Docs pass", "Idle"),
      agent("Port webhook tests", "Done"),
      agent("Spike: idempotency keys", "Closed"),
    ])).toBe("2 working · 1 idle · 1 done");
  });

  it("counts sessions and live agents in the overview, never the closed ones", () => {
    const clusters = [
      {
        sessionId: "s1",
        title: "Refactor billing webhooks",
        agents: [
          agent("Audit retry queue schema", "Working"),
          agent("Docs pass", "Idle"),
          agent("Spike: idempotency keys", "Closed"),
        ],
      },
      {
        sessionId: "s2",
        title: "Fix flaky worktree cleanup",
        agents: [agent("Repro flaky cleanup", "Working")],
      },
    ];

    expect(agentsPaneOverviewSummary(clusters)).toBe("2 sessions delegating · 3 agents");
    expect(agentsPaneStack(clusters[0]).map((entry) => entry.identity.title))
      .toEqual(["Audit retry queue schema", "Docs pass"]);
  });

  it("reports the one most consequential fact as the status line", () => {
    expect(agentsPaneStatusLine(source("Docs pass", "Idle", { wakeScheduled: true })))
      .toBe("Idle · wake scheduled");
    expect(agentsPaneStatusLine(source("Port webhook tests", "Done", {
      latestCompletionLabel: "Completed turn",
    }))).toBe("Completed turn");
    expect(agentsPaneStatusLine(source("Spike", "Closed")))
      .toBe("Closed · transcript is read-only");
    expect(agentsPaneStatusLine(source("Repro", "Idle", { ownership: "promoted" })))
      .toBe(AGENTS_PANE_PROMOTED_BADGE);
  });
});

describe("agents pane close and promote gating", () => {
  it("asks before ending work in flight, and closes an idle or done agent instantly", () => {
    expect(agentsPaneCloseNeedsConfirm(agent("Audit retry queue schema", "Working"))).toBe(true);
    expect(agentsPaneCloseNeedsConfirm(agent("Docs pass", "Idle"))).toBe(false);
    expect(agentsPaneCloseNeedsConfirm(agent("Port webhook tests", "Done"))).toBe(false);
  });

  it("offers close once, and never on an agent already closing or closed", () => {
    expect(agentsPaneCanClose(agent("Audit retry queue schema", "Working"))).toBe(true);
    expect(agentsPaneCanClose(agent("Spike", "Closed"))).toBe(false);
    expect(agentsPaneCanClose(agent("Audit", "Working", { closeRequested: true }))).toBe(false);
  });

  it("offers promotion only where there is something to be promoted out of", () => {
    expect(agentsPaneCanPromote(agent("Audit retry queue schema", "Working"))).toBe(true);
    expect(agentsPaneCanPromote(agent("Repro", "Working", { ownership: "owned_agent" })))
      .toBe(false);
    expect(agentsPaneCanPromote(agent("Repro", "Working", { ownership: "promoted" })))
      .toBe(false);
    expect(agentsPaneCanPromote(agent("Spike", "Closed"))).toBe(false);
  });

  it("keeps the confirm copy exactly, and says what close actually does", () => {
    // ADR §4 wrote "it will finish the current step, then stop" — that is §6's
    // SOFT close, which stamps `closed_by_session_id` and so has no human
    // route. The human button hits `POST /sessions/{id}/close`, which stops the
    // tree now. The copy has to describe the wiring that exists, or the confirm
    // is a lie. See the ADR §4 amendment and #1734.
    expect(AGENTS_PANE_CLOSE_CONFIRM_BODY).toBe(
      "It's mid-turn — closing stops it now. "
      + "The transcript stays readable under Closed.",
    );
    expect(AGENTS_PANE_CLOSE_CONFIRM_BODY).not.toContain("finish the current step");
    expect(AGENTS_PANE_PROMOTE_CONFIRM_BODY).toBe(
      "It becomes a top-level session in this workspace's tabs, keeps its transcript, "
      + "and can spawn its own subagents",
    );
  });
});

describe("agents pane close attribution", () => {
  it("names the closer and the reason when the read models carry both", () => {
    expect(agentsPaneCloseAttribution({
      closedByTitle: "Refactor billing webhooks",
      closeReason: "superseded",
    })).toBe("Closed by Refactor billing webhooks · superseded");
  });

  it("stays silent rather than inventing a closer", () => {
    // A landed close leaves the open-links read model entirely, so there is
    // nothing to attribute — and a guess would be worse than a blank.
    expect(agentsPaneCloseAttribution({})).toBeNull();
    expect(agentsPaneCloseAttribution({ closedByTitle: "  ", closeReason: null })).toBeNull();
    expect(agentsPaneCloseAttribution({ closeReason: "superseded" }))
      .toBe("Closed · superseded");
  });

  it("resolves the closer from the sessions the client already holds", () => {
    const closed = source("Repro flake", "Working", {
      closedBySessionId: "sess_parent",
      closeReason: "superseded",
    });

    expect(agentsPaneCloseAttributionForAgent(
      closed,
      (sessionId) => (sessionId === "sess_parent" ? "Refactor billing webhooks" : null),
    )).toBe("Closed by Refactor billing webhooks · superseded");
  });

  it("falls back to the short id when nothing knows the closing session", () => {
    const closed = source("Repro flake", "Working", {
      closedBySessionId: "9f3c2a10-0000-4000-8000-000000000000",
      closeReason: "superseded",
    });

    expect(agentsPaneCloseAttributionForAgent(closed, () => "9f3c2a"))
      .toBe("Closed by 9f3c2a · superseded");
  });

  it("says nothing when no close has been requested", () => {
    expect(agentsPaneCloseAttributionForAgent(
      source("Repro flake", "Working"),
      () => "Never asked",
    )).toBeNull();
  });
});

describe("agents pane clusters", () => {
  it("keeps a child's peers out of its parent's cluster", () => {
    const clusters = buildAgentsPaneClusters({
      activeSessionId: "sess_child",
      activeSessionTitle: "Repro the flake",
      ownRows: [source("Bisect the suite", "Working")],
      ownedAgents: [source("Docs peer", "Idle", { ownership: "owned_agent" })],
      parent: { sessionId: "sess_parent", title: "Refactor billing webhooks" },
      siblingRows: [source("Audit retry queue schema", "Working")],
    });

    expect(clusters.map((cluster) => cluster.sessionId))
      .toEqual(["sess_child", "sess_parent"]);
    expect(clusters[0].title).toBe("Repro the flake");
    expect(clusters[0].agents.map((agent) => agent.identity.title))
      .toEqual(["Bisect the suite", "Docs peer"]);
    // The parent spawned exactly one agent. Its cluster must not grow the
    // child's own fanout or the peers the child owns.
    expect(clusters[1].title).toBe("Refactor billing webhooks");
    expect(clusters[1].agents.map((agent) => agent.identity.title))
      .toEqual(["Audit retry queue schema"]);
  });

  it("lists one cluster when the session in view has no parent", () => {
    const clusters = buildAgentsPaneClusters({
      activeSessionId: "sess_top",
      activeSessionTitle: null,
      ownRows: [source("Audit retry queue schema", "Working")],
      ownedAgents: [],
      parent: null,
      siblingRows: [],
    });

    expect(clusters).toHaveLength(1);
    expect(clusters[0].title).toBe("This session");
  });

  it("drops a cluster with nothing in it rather than showing an empty owner", () => {
    expect(buildAgentsPaneClusters({
      activeSessionId: "sess_child",
      activeSessionTitle: "Repro the flake",
      ownRows: [],
      ownedAgents: [],
      parent: { sessionId: "sess_parent", title: "Refactor billing webhooks" },
      siblingRows: [],
    })).toEqual([]);
  });
});

describe("agents pane detail entries", () => {
  it("carries only the facts the read models hold", () => {
    const entries = agentsPaneDetailEntries(
      agent("Audit retry queue schema", "Done", { latestCompletionLabel: "Completed turn" }),
    );

    expect(entries.map((entry) => entry.label)).toEqual(["Parent prompt", "Agent"]);
    expect(entries[0].text).toBe("Audit retry queue schema");
    // No tool cursor and no message text exist on this endpoint, so no line
    // claims one.
    expect(entries.some((entry) => entry.kind === "tool")).toBe(false);
  });
});
