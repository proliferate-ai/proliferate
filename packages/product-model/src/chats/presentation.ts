import type { ChatKind, ClaimState } from "./model";

export type ChatKindIconId =
  | "message-square"
  | "calendar-clock"
  | "users"
  | "cloud"
  | "send";

export type PresentationTone = "blue" | "green" | "muted" | "orange" | "purple";

export interface ChatKindPresentation {
  label: string;
  description: string;
  iconId: ChatKindIconId;
  tone: PresentationTone;
}

const chatKindPresentationByKind: Record<ChatKind, ChatKindPresentation> = {
  slack: {
    label: "Slack",
    description: "Team request from Slack",
    iconId: "message-square",
    tone: "green",
  },
  "shared-auto": {
    label: "Automation",
    description: "Team automation run",
    iconId: "calendar-clock",
    tone: "blue",
  },
  "shared-chat": {
    label: "Shared chat",
    description: "Team cloud chat",
    iconId: "users",
    tone: "purple",
  },
  cloud: {
    label: "Personal cloud",
    description: "Personal cloud session",
    iconId: "cloud",
    tone: "muted",
  },
  dispatch: {
    label: "Dispatch",
    description: "Quick local dispatch",
    iconId: "send",
    tone: "orange",
  },
};

export function chatKindPresentation(kind: ChatKind): ChatKindPresentation {
  return chatKindPresentationByKind[kind];
}

export function claimStateLabel(claimState: ClaimState): string {
  switch (claimState.kind) {
    case "not_claimable":
      return "Personal";
    case "unclaimed":
      return "Unclaimed";
    case "claimed_by_me":
      return "Claimed by you";
    case "claimed_by_other":
      return `Claimed by ${claimState.claimantName}`;
  }
}
