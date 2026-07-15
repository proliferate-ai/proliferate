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
  // Seed for the identicon cells. Derived from the same seed as name/color so
  // the same subagent draws the same shape on every surface.
  iconSeedHash: number;
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
