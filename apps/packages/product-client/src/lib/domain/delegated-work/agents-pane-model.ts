import type {
  AgentOperationsAgent,
  SubagentParentRoster,
  SubagentRosterEntry,
} from "@anyharness/sdk";

// The pane groups strictly by the server's `status.presentation` verdict.
// Clients never re-derive presentation from execution status, wake state, or
// agent kind — the runtime already folded those into the three buckets.
export type AgentsPaneGroupKey = "running" | "available" | "closed";

export const AGENTS_PANE_GROUP_ORDER: readonly AgentsPaneGroupKey[] = [
  "running",
  "available",
  "closed",
];

export type AgentsPaneAction = "close" | "open" | "promote";

export interface AgentsPaneChild {
  // Identity is the durable session id, never `configuration.agentKind`.
  sessionId: string;
  sessionLinkId: string;
  title: string;
  group: AgentsPaneGroupKey;
  // Truthful execution detail straight from the server; an errored child
  // still lives in Available but says "Failed" instead of pretending health.
  detailLabel: string;
  hasLiveActor: boolean;
  actions: readonly AgentsPaneAction[];
}

export interface AgentsPaneGroup {
  key: AgentsPaneGroupKey;
  label: string;
  children: readonly AgentsPaneChild[];
}

export interface AgentsPaneParent {
  sessionId: string;
  title: string;
  /** Children in the exact order returned by the workspace roster. */
  children: readonly AgentsPaneChild[];
  groups: readonly AgentsPaneGroup[];
  closedOnly: boolean;
}

export interface AgentsPaneModel {
  parents: readonly AgentsPaneParent[];
}

const GROUP_LABELS: Record<AgentsPaneGroupKey, string> = {
  running: "Running",
  available: "Available",
  closed: "Closed",
};

export function agentsPaneGroupLabel(key: AgentsPaneGroupKey): string {
  return GROUP_LABELS[key];
}

export function agentsPaneExecutionDetail(agent: AgentOperationsAgent): string {
  switch (agent.status.execution) {
    case "starting":
      return "Starting";
    case "running":
      return "Working";
    case "awaiting_interaction":
      return "Waiting";
    case "idle":
      return "Available";
    case "errored":
      return "Failed";
    case "closed":
      return "Closed";
  }
}

// Closed agents can only be reopened; every non-Closed agent can be closed
// or promoted. No other action inference happens client-side.
export function agentsPaneActions(
  group: AgentsPaneGroupKey,
): readonly AgentsPaneAction[] {
  return group === "closed" ? ["open"] : ["close", "promote"];
}

function buildChild(entry: SubagentRosterEntry): AgentsPaneChild {
  const group = entry.agent.status.presentation;
  return {
    sessionId: entry.agent.identity.sessionId,
    sessionLinkId: entry.relationship.sessionLinkId,
    title: entry.relationship.label?.trim()
      || entry.agent.title?.trim()
      || "Subagent",
    group,
    detailLabel: agentsPaneExecutionDetail(entry.agent),
    hasLiveActor: entry.agent.status.hasLiveActor,
    actions: agentsPaneActions(group),
  };
}

function buildParent(roster: SubagentParentRoster): AgentsPaneParent {
  // Children keep the server's order both across and within groups.
  const children = roster.children.map(buildChild);
  const groups = AGENTS_PANE_GROUP_ORDER.map((key): AgentsPaneGroup => ({
    key,
    label: agentsPaneGroupLabel(key),
    children: children.filter((child) => child.group === key),
  }));
  return {
    sessionId: roster.parent.identity.sessionId,
    title: roster.parent.title?.trim() || "Parent agent",
    children,
    groups,
    closedOnly:
      children.length > 0 && children.every((child) => child.group === "closed"),
  };
}

// Pure projection of the server roster into the agents pane. Parents stay in
// server order, and parents whose children are all Closed are retained so the
// pane never silently drops finished work.
export function buildAgentsPaneModel(
  rosters: readonly SubagentParentRoster[],
): AgentsPaneModel {
  return { parents: rosters.map(buildParent) };
}
