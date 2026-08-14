export type DelegatedWorkKind = "subagent" | "cowork" | "plan_review" | "code_review";

export type DelegatedWorkSource = "subagent" | "review" | "cowork";

export type DelegatedWorkStatusCategory =
  | "needs_attention"
  | "failed"
  | "running"
  | "queued"
  | "wake_scheduled"
  | "finished"
  | "closed";

export interface DelegatedAgentOpenTarget {
  workspaceId: string | null;
  sessionId: string;
  sessionLinkId?: string | null;
}

export interface DelegatedAgentIdentity {
  id: string;
  sessionId: string | null;
  generatedName: string;
  initial: string;
  title: string;
  shortId: string;
  displayName: string;
  colorToken: string;
  colorClassName: string;
  textColorClassName: string;
  borderColorClassName: string;
  colorVar: string;
  // Seed for the identity glyph. Once a durable session exists this is derived
  // only from that session ID, so relationship-link churn cannot change the
  // agent's shape or color between surfaces.
  glyphSeedHash: number;
  openTarget: DelegatedAgentOpenTarget | null;
}

export interface DelegatedWorkTabIdentity {
  identity: DelegatedAgentIdentity;
  kind: DelegatedWorkKind;
  originLabel: string;
  statusCategory: DelegatedWorkStatusCategory;
  statusLabel: string;
  parentTitle: string | null;
  hoverTitle: string;
}
