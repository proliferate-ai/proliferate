import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ChatPreviewSurface, type ChatPreviewMessageView } from "@proliferate/product-ui/chat/ChatPreviewSurface";
import type { ClaimBannerView } from "@proliferate/product-ui/chat/ClaimBanner";
import { ProductPageShell } from "@proliferate/product-ui/layout/ProductPageShell";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { deriveClaimState, getPrimaryChatAction } from "@proliferate/product-model/chats/claiming";
import type { ClaimState } from "@proliferate/product-model/chats/model";
import { chatKindPresentation, claimStateLabel } from "@proliferate/product-model/chats/presentation";

import { routes } from "../../../config/routes";
import {
  chatMessages,
  chats,
  currentUser,
  workspaces,
  workspaceForChat,
} from "../../../lib/fixtures/web-fixtures";

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function ChatScreen() {
  const { workspaceId, chatId } = useParams();
  const navigate = useNavigate();
  const chat = chats.find((candidate) => candidate.id === chatId && candidate.workspaceId === workspaceId);
  const workspace = chat ? workspaceForChat(chat) : workspaces[0];
  const messages = useMemo(() => (chat ? chatMessages[chat.id] ?? [] : []), [chat]);

  if (!chat || !workspace) {
    return (
      <ProductPageShell
        title="Session not found"
        description="The mocked session route does not exist."
        telemetryBlocked
      >
        <EmptyState title="Session not found" description="Go home and choose another session." />
      </ProductPageShell>
    );
  }

  const presentation = chatKindPresentation(chat.kind);
  const claimState = deriveClaimState(chat, currentUser);
  const primaryAction = getPrimaryChatAction(chat, currentUser);

  return (
    <ChatPreviewSurface
      title={chat.title}
      eyebrowItems={[presentation.label, claimStateLabel(claimState), statusLabel(chat.status)]}
      branchLabel={workspace.branchLabel}
      repoLabel={workspace.repoLabel}
      descriptionLabel={presentation.description}
      claimBanner={buildClaimBannerView(claimState)}
      messages={buildMessages(messages)}
      primaryAction={
        primaryAction.kind === "none"
          ? null
          : {
              label: primaryAction.label,
              kind: primaryAction.kind === "claim" ? "claim" : "continue",
            }
      }
      telemetryBlocked
      onBack={() => navigate(routes.home)}
    />
  );
}

function buildClaimBannerView(claimState: ClaimState): ClaimBannerView {
  if (claimState.kind === "unclaimed") {
    return {
      kind: "unclaimed",
      title: "Unclaimed shared session",
      description: "Claim this session before continuing it from Desktop.",
      actionLabel: "Claim",
    };
  }

  if (claimState.kind === "claimed_by_other") {
    return {
      kind: "claimed_by_other",
      claimantName: claimState.claimantName,
      description: "Only the current claimant can continue this shared session from Desktop.",
    };
  }

  return { kind: "hidden" };
}

function buildMessages(messages: typeof chatMessages[string]): ChatPreviewMessageView[] {
  if (messages.length > 0) {
    return messages;
  }

  return [
    {
      id: "fallback-user",
      role: "user",
      body: "Open this session and show the latest mocked workspace context.",
    },
    {
      id: "fallback-assistant",
      role: "assistant",
      body: "Loaded the workspace state, active branch, and claim metadata for this preview session.",
    },
  ];
}
