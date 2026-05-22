import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Brain,
  CheckCircle2,
  Clock3,
  ExternalLink,
  GitBranch,
  Loader2,
  MoreHorizontal,
  Send,
  Terminal,
  User,
  Wrench,
} from "lucide-react";
import type { FormEvent } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { Textarea } from "@proliferate/ui/primitives/Textarea";

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

export type CloudChatTranscriptRowKind =
  | "assistant"
  | "error"
  | "system"
  | "thought"
  | "tool"
  | "tool_group"
  | "user";

export interface CloudChatTranscriptRowView {
  id: string;
  kind: CloudChatTranscriptRowKind;
  title?: string | null;
  body?: string | null;
  detail?: string | null;
  status?: string | null;
  streaming?: boolean;
}

export interface CloudChatComposerView {
  value: string;
  placeholder: string;
  disabled?: boolean;
  canSubmit: boolean;
  isSubmitting?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
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
  function submitComposer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (composer.canSubmit && !composer.disabled) {
      composer.onSubmit();
    }
  }

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

          {transcriptRows.length > 0 ? (
            <div className="space-y-3">
              {transcriptRows.map((row) => (
                <CloudChatTranscriptRow key={row.id} row={row} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-card p-5 text-sm">
              <div className="font-medium text-foreground">{emptyTitle}</div>
              {emptyDescription ? (
                <p className="mt-1 text-muted-foreground">{emptyDescription}</p>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <footer className="shrink-0 border-t border-border p-4">
        <form
          onSubmit={submitComposer}
          className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg border border-input bg-card p-2"
        >
          <Textarea
            rows={2}
            value={composer.value}
            onChange={(event) => composer.onChange(event.currentTarget.value)}
            disabled={composer.disabled}
            className="min-h-10 flex-1 resize-none bg-transparent px-2 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            placeholder={composer.placeholder}
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Send message"
            disabled={!composer.canSubmit}
            loading={composer.isSubmitting}
          >
            <Send size={15} />
          </Button>
        </form>
        {commandMessage ? (
          <p className="mx-auto mt-2 max-w-3xl text-xs text-muted-foreground">
            {commandMessage}
          </p>
        ) : null}
      </footer>
    </div>
  );
}

function CloudChatTranscriptRow({ row }: { row: CloudChatTranscriptRowView }) {
  if (row.kind === "user") {
    return (
      <article className="flex justify-end">
        <div
          className="max-w-[77%] whitespace-pre-wrap break-words rounded-2xl bg-foreground/5 px-3 py-2 text-sm leading-6 text-foreground"
          data-telemetry-mask
        >
          {row.body}
        </div>
      </article>
    );
  }

  if (row.kind === "assistant") {
    return (
      <article className="flex justify-start">
        <div className="min-w-0 max-w-full text-sm leading-6 text-foreground" data-telemetry-mask>
          {row.title ? (
            <div className="mb-1 text-xs font-medium text-muted-foreground">{row.title}</div>
          ) : null}
          <div className="whitespace-pre-wrap break-words">{row.body}</div>
          {row.streaming ? (
            <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              Streaming
            </div>
          ) : null}
        </div>
      </article>
    );
  }

  const Icon = iconForRow(row);
  return (
    <article className="flex justify-start">
      <div className="flex min-w-0 max-w-full items-start gap-2 rounded-lg border border-border bg-card/70 px-3 py-2 text-sm">
        <Icon size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-foreground">
              {row.title ?? titleForRow(row)}
            </span>
            {row.status ? (
              <span className="shrink-0 text-xs text-muted-foreground">{row.status}</span>
            ) : null}
          </div>
          {row.detail ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground" data-telemetry-mask>
              {row.detail}
            </div>
          ) : null}
          {row.body ? (
            <pre
              className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-md bg-background px-2 py-1.5 text-xs leading-5 text-muted-foreground"
              data-telemetry-mask
            >
              {row.body}
            </pre>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function iconForRow(row: CloudChatTranscriptRowView) {
  switch (row.kind) {
    case "error":
      return AlertTriangle;
    case "system":
      return Bot;
    case "thought":
      return Brain;
    case "tool":
      return row.status === "completed" ? CheckCircle2 : Terminal;
    case "tool_group":
      return Wrench;
    case "user":
      return User;
    case "assistant":
    default:
      return row.streaming ? Clock3 : Bot;
  }
}

function titleForRow(row: CloudChatTranscriptRowView): string {
  switch (row.kind) {
    case "error":
      return "Error";
    case "system":
      return "System";
    case "thought":
      return "Reasoning";
    case "tool_group":
      return "Actions";
    case "tool":
      return "Tool call";
    case "user":
      return "User";
    case "assistant":
    default:
      return "Assistant";
  }
}
