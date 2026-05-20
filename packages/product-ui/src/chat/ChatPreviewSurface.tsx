import { ArrowLeft, ExternalLink, GitBranch, MoreHorizontal, Send } from "lucide-react";
import { Button } from "@proliferate/ui/primitives/Button";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { ClaimBanner, type ClaimBannerView } from "./ClaimBanner";

export interface ChatPreviewMessageView {
  id: string;
  role: string;
  body: string;
}

export interface ChatPreviewActionView {
  label: string;
  kind?: "claim" | "continue" | "default";
  onClick?: () => void;
}

interface ChatPreviewSurfaceProps {
  title: string;
  eyebrowItems: string[];
  branchLabel: string;
  repoLabel: string;
  descriptionLabel: string;
  claimBanner: ClaimBannerView;
  messages: ChatPreviewMessageView[];
  primaryAction?: ChatPreviewActionView | null;
  telemetryBlocked?: boolean;
  onBack: () => void;
}

export function ChatPreviewSurface({
  title,
  eyebrowItems,
  branchLabel,
  repoLabel,
  descriptionLabel,
  claimBanner,
  messages,
  primaryAction = null,
  telemetryBlocked = false,
  onBack,
}: ChatPreviewSurfaceProps) {
  return (
    <div className="flex h-full flex-col" data-telemetry-block={telemetryBlocked || undefined}>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <IconButton title="Back" onClick={onBack}>
          <ArrowLeft size={16} />
        </IconButton>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {eyebrowItems.map((item, index) => (
              <span key={`${item}-${index}`} className="contents">
                {index > 0 ? <span>-</span> : null}
                <span>{item}</span>
              </span>
            ))}
          </div>
          <h1 className="truncate text-sm font-semibold">{title}</h1>
        </div>
        {primaryAction ? (
          <Button variant={primaryAction.kind === "claim" ? "secondary" : "outline"} size="sm" onClick={primaryAction.onClick}>
            {primaryAction.kind === "continue" ? <ExternalLink size={14} /> : null}
            {primaryAction.label}
          </Button>
        ) : null}
        <IconButton title="Session menu">
          <MoreHorizontal size={16} />
        </IconButton>
      </header>

      <div className="proliferate-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1">
              <GitBranch size={13} />
              {branchLabel}
            </span>
            <span className="rounded-md border border-border px-2 py-1">{repoLabel}</span>
            <span className="rounded-md border border-border px-2 py-1">{descriptionLabel}</span>
          </div>

          <ClaimBanner view={claimBanner} />

          <div className="mt-5 space-y-3">
            {messages.map((message) => (
              <article
                key={message.id}
                className={`rounded-lg border border-border p-4 ${
                  message.role === "assistant" ? "bg-card" : "bg-background"
                }`}
              >
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                  {message.role}
                </div>
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
