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
