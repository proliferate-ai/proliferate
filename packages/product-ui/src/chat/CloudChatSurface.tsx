import {
  ArrowLeft,
  ExternalLink,
  GitBranch,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@proliferate/ui/primitives/Button";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import {
  CloudChatComposer,
  type CloudChatComposerView,
} from "./CloudChatComposer";
import {
  CloudChatTranscript,
  type CloudChatTranscriptRowView,
} from "./CloudChatTranscript";

export interface CloudChatChipView {
  id: string;
  label: string;
  icon?: "branch";
}

export interface CloudChatPrimaryActionView {
  label: string;
  kind?: "claim" | "continue" | "default";
  loading?: boolean;
  onClick?: () => void;
}

export interface CloudChatSurfaceProps {
  title: string;
  eyebrowItems: readonly string[];
  chips: readonly CloudChatChipView[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
  emptyTitle: string;
  emptyDescription?: string;
  composer: CloudChatComposerView;
  commandMessage?: string | null;
  primaryAction?: CloudChatPrimaryActionView | null;
  desktopHref?: string | null;
  telemetryBlocked?: boolean;
  onBack: () => void;
}

export function CloudChatSurface({
  title,
  eyebrowItems,
  chips,
  transcriptRows,
  emptyTitle,
  emptyDescription,
  composer,
  commandMessage = null,
  primaryAction = null,
  desktopHref = null,
  telemetryBlocked = false,
  onBack,
}: CloudChatSurfaceProps) {
  return (
    <div className="flex h-full flex-col" data-telemetry-block={telemetryBlocked || undefined}>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <IconButton title="Back" onClick={onBack}>
          <ArrowLeft size={16} />
        </IconButton>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {eyebrowItems.map((item, index) => (
              <span key={`${item}-${index}`} className="contents">
                {index > 0 ? <span>-</span> : null}
                <span className="truncate">{item}</span>
              </span>
            ))}
          </div>
          <h1 className="truncate text-sm font-semibold">{title}</h1>
        </div>
        {primaryAction ? (
          <Button
            variant={primaryAction.kind === "claim" ? "secondary" : "outline"}
            size="sm"
            loading={primaryAction.loading}
            onClick={primaryAction.onClick}
          >
            {primaryAction.kind === "continue" ? <ExternalLink size={14} /> : null}
            {primaryAction.label}
          </Button>
        ) : null}
        {desktopHref ? (
          <a
            href={desktopHref}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-input px-3 text-xs text-muted-foreground hover:bg-accent"
          >
            <ExternalLink size={14} />
            Desktop
          </a>
        ) : null}
        <IconButton title="Session menu">
          <MoreHorizontal size={16} />
        </IconButton>
      </header>

      <div className="web-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-6 py-6">
          {chips.length > 0 ? (
            <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {chips.map((chip) => (
                <span
                  key={chip.id}
                  className="inline-flex min-w-0 items-center gap-1 rounded-md border border-border px-2 py-1"
                >
                  {chip.icon === "branch" ? <GitBranch size={13} /> : null}
                  <span className="truncate">{chip.label}</span>
                </span>
              ))}
            </div>
          ) : null}

          <CloudChatTranscript
            rows={transcriptRows}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
          />
        </div>
      </div>

      <footer className="shrink-0 border-t border-border p-4">
        <CloudChatComposer composer={composer} />
        {commandMessage ? (
          <p className="mx-auto mt-2 max-w-3xl text-xs text-muted-foreground">
            {commandMessage}
          </p>
        ) : null}
      </footer>
    </div>
  );
}
