import type { AgentOwnershipState } from "#product/domain/chats/subagents/ownership";
import type { DelegatedAgentIdentity } from "#product/lib/domain/delegated-work/model";

/**
 * The agents pane, as data (ADR §4 "Agents pane", Agents Pane + Closures
 * canvas pages).
 *
 * One global pane, overview → drill. Level 1 lists only the sessions that are
 * delegating; level 2 is that session's cluster, split into Working / Idle /
 * Done / Closed; level 3 is one agent. Native harness work and terminals never
 * appear here — they stay read-only, elsewhere.
 *
 * Everything here is pure so the partitioning, the summaries and the confirm
 * gating can be tested without a runtime.
 */

export type AgentsPaneSectionKey = "working" | "idle" | "done" | "closed";

/** The subset of a delegated-work row the pane reads. */
export interface AgentsPaneAgentSource {
  sessionLinkId: string;
  childSessionId: string;
  identity: DelegatedAgentIdentity;
  /** "Working" | "Idle" | "Done" | "Failed" | "Starting" | "Closed". */
  statusLabel: string;
  latestCompletionLabel: string | null;
  wakeScheduled: boolean;
  closeRequested: boolean;
  closeRequestedLabel: string | null;
  /** Who asked for the close and why, while the close has not landed. */
  closedBySessionId: string | null;
  closeReason: string | null;
  ownership: AgentOwnershipState;
  workspaceId: string | null;
}

export interface AgentsPaneAgent extends AgentsPaneAgentSource {
  /** The one status line under the title. */
  statusLine: string;
  section: AgentsPaneSectionKey;
}

export interface AgentsPaneCluster {
  sessionId: string;
  title: string;
  agents: AgentsPaneAgent[];
}

export interface AgentsPaneSection {
  key: AgentsPaneSectionKey;
  title: string;
  agents: AgentsPaneAgent[];
}

const SECTION_ORDER: { key: AgentsPaneSectionKey; title: string }[] = [
  { key: "working", title: "Working" },
  { key: "idle", title: "Idle" },
  { key: "done", title: "Done" },
  { key: "closed", title: "Closed" },
];

export function agentsPaneSectionKey(source: {
  statusLabel: string;
  closeRequested?: boolean;
}): AgentsPaneSectionKey {
  const normalized = source.statusLabel.trim().toLowerCase();
  if (normalized === "closed") {
    return "closed";
  }
  // A requested close has not landed: the agent is still working, and it is
  // working its last step. It belongs under Working until it stops.
  if (source.closeRequested) {
    return "working";
  }
  if (normalized === "working" || normalized === "starting") {
    return "working";
  }
  if (normalized === "done" || normalized === "failed") {
    return "done";
  }
  // Anything else is waiting on something — including an agent with a wake
  // armed, which is idle until the wake fires.
  return "idle";
}

/**
 * The single status line under an agent's title. One line, never two: the pane
 * reports the most consequential fact it has and stops.
 */
export function agentsPaneStatusLine(source: AgentsPaneAgentSource): string {
  const section = agentsPaneSectionKey(source);
  if (section === "closed") {
    return "Closed · transcript is read-only";
  }
  if (source.closeRequestedLabel) {
    return source.closeRequestedLabel;
  }
  if (source.ownership === "promoted") {
    return AGENTS_PANE_PROMOTED_BADGE;
  }
  if (source.wakeScheduled) {
    return `${source.statusLabel} · wake scheduled`;
  }
  return source.latestCompletionLabel ?? source.statusLabel;
}

export function toAgentsPaneAgent(source: AgentsPaneAgentSource): AgentsPaneAgent {
  return {
    ...source,
    statusLine: agentsPaneStatusLine(source),
    section: agentsPaneSectionKey(source),
  };
}

/** Only non-empty sections render, in the locked Working → Closed order. */
export function partitionAgentsPaneSections(
  agents: readonly AgentsPaneAgent[],
): AgentsPaneSection[] {
  return SECTION_ORDER
    .map((section) => ({
      ...section,
      agents: agents.filter((agent) => agent.section === section.key),
    }))
    .filter((section) => section.agents.length > 0);
}

/** "2 working · 1 idle · 1 done" — the live summary under a cluster title. */
export function agentsPaneClusterSummary(agents: readonly AgentsPaneAgent[]): string {
  const count = (key: AgentsPaneSectionKey) =>
    agents.filter((agent) => agent.section === key).length;
  return [
    count("working") > 0 ? `${count("working")} working` : null,
    count("idle") > 0 ? `${count("idle")} idle` : null,
    count("done") > 0 ? `${count("done")} done` : null,
  ].filter((part): part is string => part !== null).join(" · ")
    || "no agents working";
}

/** "2 sessions delegating · 5 agents" — the overview's own summary line. */
export function agentsPaneOverviewSummary(clusters: readonly AgentsPaneCluster[]): string {
  const sessionCount = clusters.length;
  const agentCount = clusters.reduce(
    (total, cluster) => total + agentsPaneStack(cluster).length,
    0,
  );
  return `${sessionCount} ${sessionCount === 1 ? "session" : "sessions"} delegating`
    + ` · ${agentCount} ${agentCount === 1 ? "agent" : "agents"}`;
}

/** The overview's glyph stack: live agents only — a closed one is not on it. */
export function agentsPaneStack(cluster: AgentsPaneCluster): AgentsPaneAgent[] {
  return cluster.agents.filter((agent) => agent.section !== "closed");
}

/** Level 1 shows only sessions that are actually delegating. */
export function agentsPaneDelegatingClusters(
  clusters: readonly AgentsPaneCluster[],
): AgentsPaneCluster[] {
  return clusters.filter((cluster) => cluster.agents.length > 0);
}

/**
 * Who closed an agent, when the read models say so. Returns null rather than a
 * guess: the subagents endpoint returns OPEN links only, so attribution exists
 * exactly in the close-requested window and in the transcript receipt. The pane
 * must not invent a closer for a close that already landed.
 */
export function agentsPaneCloseAttribution(source: {
  closedByTitle?: string | null;
  closeReason?: string | null;
}): string | null {
  const closedBy = source.closedByTitle?.trim() || null;
  const reason = source.closeReason?.trim() || null;
  if (!closedBy && !reason) {
    return null;
  }
  if (closedBy && reason) {
    return `Closed by ${closedBy} · ${reason}`;
  }
  return closedBy ? `Closed by ${closedBy}` : `Closed · ${reason}`;
}

/**
 * The pane's own attribution line for one agent.
 *
 * `closedBySessionId` is a session id, not a name. `resolveTitle` looks it up
 * in whatever the client already has; when nothing knows that session the line
 * falls back to its short id rather than inventing a title or dropping the
 * reason on the floor.
 */
export function agentsPaneCloseAttributionForAgent(
  agent: Pick<AgentsPaneAgentSource, "closedBySessionId" | "closeReason">,
  resolveTitle: (sessionId: string) => string | null,
): string | null {
  const closerId = agent.closedBySessionId?.trim();
  return agentsPaneCloseAttribution({
    closedByTitle: closerId ? resolveTitle(closerId) : null,
    closeReason: agent.closeReason,
  });
}

/**
 * Level 1's clusters, partitioned honestly.
 *
 * The session-subagents endpoint is per session and returns two different
 * things: the fanout the session in view PARENTS (plus the peers it owns), and
 * — when a child is in view — the sibling strip, which is the PARENT's fanout.
 * Those belong to two different owners, so they become two clusters. Folding
 * the siblings into the session's own cluster would file a child's peers under
 * a parent that never spawned them; folding the session's own fanout under the
 * parent's title would claim the parent spawned agents it has never seen.
 */
export function buildAgentsPaneClusters(input: {
  activeSessionId: string | null;
  activeSessionTitle: string | null;
  /** The session in view: the subagents it parents. */
  ownRows: readonly AgentsPaneAgentSource[];
  /** The session in view: the peers it owns. */
  ownedAgents: readonly AgentsPaneAgentSource[];
  /** Set when a CHILD is in view: its parent, and that parent's own fanout. */
  parent: { sessionId: string; title: string } | null;
  siblingRows: readonly AgentsPaneAgentSource[];
}): AgentsPaneCluster[] {
  const clusters: AgentsPaneCluster[] = [];
  const own = [...input.ownRows, ...input.ownedAgents].map(toAgentsPaneAgent);
  if (input.activeSessionId && own.length > 0) {
    clusters.push({
      sessionId: input.activeSessionId,
      title: input.activeSessionTitle ?? "This session",
      agents: own,
    });
  }
  if (input.parent && input.siblingRows.length > 0) {
    clusters.push({
      sessionId: input.parent.sessionId,
      title: input.parent.title,
      agents: input.siblingRows.map(toAgentsPaneAgent),
    });
  }
  return clusters;
}

/**
 * Level 3's body: Parent prompt / current Tool / latest Agent message.
 *
 * Only what the read models actually carry gets a line. The session-subagents
 * endpoint reports the delegated task and the latest completion; it carries no
 * tool cursor and no message text, so those lines are absent rather than
 * faked, and the transcript stays the place to read what an agent said.
 */
export interface AgentsPaneDetailEntry {
  kind: "parent" | "tool" | "agent" | "system";
  label: string;
  text: string;
}

export function agentsPaneDetailEntries(
  agent: AgentsPaneAgent,
  extras?: { toolLine?: string | null; closeAttribution?: string | null },
): AgentsPaneDetailEntry[] {
  const entries: AgentsPaneDetailEntry[] = [
    { kind: "parent", label: "Parent prompt", text: agent.identity.title },
  ];
  const toolLine = extras?.toolLine?.trim();
  if (toolLine) {
    entries.push({ kind: "tool", label: "Tool", text: toolLine });
  }
  if (agent.latestCompletionLabel) {
    entries.push({ kind: "agent", label: "Agent", text: agent.latestCompletionLabel });
  }
  const closeAttribution = extras?.closeAttribution?.trim();
  if (closeAttribution) {
    entries.push({ kind: "system", label: "System", text: closeAttribution });
  }
  return entries;
}

/**
 * Closing an agent that is working would end work in flight, so it asks first.
 * An idle or finished agent closes instantly — close is routine, not an alarm.
 */
export function agentsPaneCloseNeedsConfirm(agent: AgentsPaneAgent): boolean {
  return agent.section === "working";
}

/** Promotion is offered only where there is something to be promoted out of. */
export function agentsPaneCanPromote(agent: AgentsPaneAgent): boolean {
  return agent.ownership === "subagent"
    && agent.section !== "closed"
    && !agent.closeRequested;
}

export function agentsPaneCanClose(agent: AgentsPaneAgent): boolean {
  return agent.section !== "closed" && !agent.closeRequested;
}

/**
 * What the human close actually does today.
 *
 * ADR §4 writes this confirm as "it will finish the current step, then stop",
 * which is §6 step 5.3's soft close — and that mechanism is agent-attributed by
 * design (`closed_by_session_id` names the closing SESSION), so there is no
 * human soft-close route to reach it. The human route is `POST
 * /v1/sessions/{id}/close`, which shuts the tree down immediately. Until the
 * route exists the copy says what happens rather than what was designed; the
 * tone stays calm, because close is routine, not an alarm.
 *
 * See the ADR §4 "Closing" amendment and the human soft-close item on #1734.
 */
export const AGENTS_PANE_CLOSE_CONFIRM_BODY =
  "It's mid-turn — closing stops it now. "
  + "The transcript stays readable under Closed.";

export const AGENTS_PANE_PROMOTE_CONFIRM_BODY =
  "It becomes a top-level session in this workspace's tabs, keeps its transcript, "
  + "and can spawn its own subagents";

export const AGENTS_PANE_PROMOTED_BADGE = "Promoted · top-level session";

/**
 * ADR §4's fourth detail action, verbatim. The client's session config surface
 * (`SessionConfigControls` over `POST /sessions/{id}/config-options`) is built
 * for the session in view and has no out-of-tab form, so the action opens the
 * agent's tab where those controls already are — and says so, rather than
 * looking like a dialog that never comes.
 */
export const AGENTS_PANE_CONFIGURE_ACTION = "Configure agent…";
export const AGENTS_PANE_CONFIGURE_HINT =
  "Opens the agent's tab — its model, mode and effort controls live in its own composer.";

export const AGENTS_PANE_COMPOSER_PLACEHOLDER =
  "Message this agent — delivered on its next turn";

/**
 * `wakeOnReply` is a property of the agents' own `send_agent_message` tool. The
 * human send route (`POST /sessions/{id}/prompt`) carries no such flag, so the
 * toggle renders disabled and says why rather than lying about what it arms.
 */
export const AGENTS_PANE_WAKE_TOGGLE_LABEL = "Wake me on reply";
export const AGENTS_PANE_WAKE_TOGGLE_UNAVAILABLE_HINT =
  "Only agents can arm a wake on reply — the human message route has no wake flag yet.";
