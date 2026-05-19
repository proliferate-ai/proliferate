import { ArrowLeft, ExternalLink, GitBranch, MoreHorizontal, Send } from "lucide-react";
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Button } from "@proliferate/ui/primitives/Button";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { deriveClaimState, getPrimaryChatAction } from "@proliferate/product-model/chats/claiming";
import { chatKindPresentation, claimStateLabel } from "@proliferate/product-model/chats/presentation";

import { routes } from "../../../config/routes";
import {
  chatMessages,
  chats,
  currentUser,
  workspaces,
  workspaceForChat,
} from "../../../lib/fixtures/web-fixtures";
import { ClaimBanner } from "../parts/ClaimBanner";

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
      <div className="flex h-full items-center justify-center">
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold">Session not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">The mocked session route does not exist.</p>
          <Button className="mt-4" onClick={() => navigate(routes.home)}>
            Go home
          </Button>
        </div>
      </div>
    );
  }

  const presentation = chatKindPresentation(chat.kind);
  const claimState = deriveClaimState(chat, currentUser);
  const primaryAction = getPrimaryChatAction(chat, currentUser);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <IconButton title="Back" onClick={() => navigate(routes.home)}>
          <ArrowLeft size={16} />
        </IconButton>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{presentation.label}</span>
            <span>-</span>
            <span>{claimStateLabel(claimState)}</span>
            <span>-</span>
            <span>{statusLabel(chat.status)}</span>
          </div>
          <h1 className="truncate text-sm font-semibold">{chat.title}</h1>
        </div>
        {primaryAction.kind !== "none" && (
          <Button variant={primaryAction.kind === "claim" ? "secondary" : "outline"} size="sm">
            {primaryAction.kind === "continue_in_desktop" && <ExternalLink size={14} />}
            {primaryAction.label}
          </Button>
        )}
        <IconButton title="Session menu">
          <MoreHorizontal size={16} />
        </IconButton>
      </header>

      <div className="web-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1">
              <GitBranch size={13} />
              {workspace.branchLabel}
            </span>
            <span className="rounded-md border border-border px-2 py-1">{workspace.repoLabel}</span>
            <span className="rounded-md border border-border px-2 py-1">{presentation.description}</span>
          </div>

          <ClaimBanner claimState={claimState} />

          <div className="mt-5 space-y-3">
            {(messages.length > 0
              ? messages
              : [
                  {
                    id: "fallback-user",
                    role: "user" as const,
                    body: "Open this session and show the latest mocked workspace context.",
                  },
                  {
                    id: "fallback-assistant",
                    role: "assistant" as const,
                    body: "Loaded the workspace state, active branch, and claim metadata for this preview session.",
                  },
                ]).map((message) => (
              <article
                key={message.id}
                className={`rounded-lg border border-border p-4 ${
                  message.role === "assistant" ? "bg-card" : "bg-background"
                }`}
              >
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">{message.role}</div>
                <p className="text-sm leading-6 text-foreground">{message.body}</p>
              </article>
            ))}
          </div>
        </div>
      </div>

      <footer className="shrink-0 border-t border-border p-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg border border-input bg-card p-2">
          <Textarea
            rows={2}
            className="min-h-10 flex-1 resize-none bg-transparent px-2 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="Message this session"
          />
          <Button size="icon" aria-label="Send message">
            <Send size={15} />
          </Button>
        </div>
      </footer>
    </div>
  );
}
