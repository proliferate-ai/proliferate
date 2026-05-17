import type { ChatKind, ChatPrimaryAction, ClaimState, ProductChat, ProductUser } from "./model";

const teamChatKinds = new Set<ChatKind>(["slack", "shared-auto", "shared-chat"]);

export function isTeamChat(kind: ChatKind): boolean {
  return teamChatKinds.has(kind);
}

export function isClaimable(kind: ChatKind): boolean {
  return isTeamChat(kind);
}

export function deriveClaimState(chat: ProductChat, currentUser: ProductUser): ClaimState {
  if (!isClaimable(chat.kind)) {
    return { kind: "not_claimable" };
  }

  if (!chat.claimantUserId) {
    return { kind: "unclaimed" };
  }

  if (chat.claimantUserId === currentUser.id) {
    return { kind: "claimed_by_me" };
  }

  return {
    kind: "claimed_by_other",
    claimantName: chat.claimantName ?? "Someone else",
  };
}

export function canContinueInDesktop(chat: ProductChat, currentUser: ProductUser): boolean {
  const claimState = deriveClaimState(chat, currentUser);
  return claimState.kind === "not_claimable" || claimState.kind === "claimed_by_me";
}

export function getPrimaryChatAction(chat: ProductChat, currentUser: ProductUser): ChatPrimaryAction {
  const claimState = deriveClaimState(chat, currentUser);

  if (claimState.kind === "unclaimed") {
    return { kind: "claim", label: "Claim" };
  }

  if (canContinueInDesktop(chat, currentUser)) {
    return { kind: "continue_in_desktop", label: "Continue in desktop" };
  }

  return { kind: "none", label: "" };
}
