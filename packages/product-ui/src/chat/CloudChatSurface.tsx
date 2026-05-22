import {
  AlertTriangle,
  ArrowLeft,
  ArrowUp,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ExternalLink,
  GitBranch,
  Loader2,
  MoreHorizontal,
  Terminal,
  User,
  Wrench,
} from "lucide-react";
import { useMemo, useState, type ComponentType, type FormEvent, type KeyboardEvent } from "react";
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

export interface CloudChatComposerControlOptionView {
  id: string;
  label: string;
  description?: string | null;
  selected?: boolean;
  disabled?: boolean;
}

export interface CloudChatComposerControlGroupView {
  id: string;
  label?: string | null;
  options: readonly CloudChatComposerControlOptionView[];
}

export interface CloudChatComposerControlView {
  id: string;
  label: string;
  detail?: string | null;
  icon?: "bot" | "brain" | "cloud" | "settings";
  placement?: "leading" | "trailing";
  disabled?: boolean;
  pendingState?: "sending" | "queued" | null;
  groups: readonly CloudChatComposerControlGroupView[];
  onSelect?: (optionId: string) => void;
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
  controls?: readonly CloudChatComposerControlView[];
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
    if (composer.canSubmit && !composer.disabled && !composer.isSubmitting) {
      composer.onSubmit();
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter"
      && !event.shiftKey
      && !event.metaKey
      && !event.ctrlKey
      && !event.altKey
      && !event.nativeEvent.isComposing
      && composer.canSubmit
      && !composer.disabled
      && !composer.isSubmitting
    ) {
      event.preventDefault();
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
          className="mx-auto flex max-w-3xl flex-col rounded-[var(--radius-composer)] border border-input bg-card shadow-subtle"
        >
          <Textarea
            rows={2}
            value={composer.value}
            onChange={(event) => composer.onChange(event.currentTarget.value)}
            onKeyDown={handleComposerKeyDown}
            disabled={composer.disabled}
            className="min-h-20 resize-none border-0 bg-transparent px-3 py-3 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
            placeholder={composer.placeholder}
            data-telemetry-mask
          />
          <CloudChatComposerControlRow composer={composer} />
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

function CloudChatComposerControlRow({ composer }: { composer: CloudChatComposerView }) {
  const controls = composer.controls ?? [];
  const leadingControls = controls.filter((control) => control.placement === "leading");
  const trailingControls = controls.filter((control) => control.placement !== "leading");
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-2 px-2 pb-2">
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1">
        {leadingControls.map((control) => (
          <CloudChatComposerControlButton
            key={control.id}
            control={control}
            composerDisabled={composer.disabled}
          />
        ))}
      </div>
      <div className="min-w-0 flex-1" />
      <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1">
        {trailingControls.map((control) => (
          <CloudChatComposerControlButton
            key={control.id}
            control={control}
            composerDisabled={composer.disabled}
          />
        ))}
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          aria-label="Send message"
          disabled={!composer.canSubmit || composer.disabled || composer.isSubmitting}
          loading={composer.isSubmitting}
          className="size-7 rounded-full bg-foreground px-0 text-background shadow-none hover:bg-foreground hover:opacity-90 disabled:cursor-default disabled:opacity-50"
        >
          {composer.isSubmitting ? null : <ArrowUp size={15} />}
        </Button>
      </div>
    </div>
  );
}

function CloudChatComposerControlButton({
  control,
  composerDisabled = false,
}: {
  control: CloudChatComposerControlView;
  composerDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => selectedComposerOption(control), [control]);
  const disabled = composerDisabled || control.disabled || control.groups.every((group) =>
    group.options.every((option) => option.disabled)
  );
  const Icon = iconForComposerControl(control.icon);
  const detail = control.pendingState
    ? control.pendingState === "sending" ? "Sending" : "Queued"
    : control.detail ?? selected?.label ?? null;
  const popoverAlignClass = control.placement === "leading" ? "left-0" : "right-0";

  return (
    <div className="relative min-w-0">
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="h-7 max-w-[11rem] rounded-full px-2 text-xs text-muted-foreground hover:bg-accent"
      >
        <Icon size={13} className="shrink-0" />
        <span className="min-w-0 truncate text-foreground">
          {selected?.label ?? control.label}
        </span>
        {detail && detail !== selected?.label ? (
          <span className="hidden min-w-0 truncate text-muted-foreground sm:inline">
            {detail}
          </span>
        ) : null}
        {control.pendingState ? <Loader2 size={12} className="shrink-0 animate-spin" /> : (
          <ChevronDown size={12} className="shrink-0" />
        )}
      </Button>
      {open && !disabled ? (
        <div
          role="menu"
          className={`${popoverAlignClass} absolute bottom-full z-30 mb-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-popover`}
        >
          {control.groups.map((group) => (
            <div key={group.id}>
              {group.label ? (
                <div className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase text-muted-foreground">
                  {group.label}
                </div>
              ) : null}
              {group.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.selected || undefined}
                  disabled={option.disabled}
                  onClick={() => {
                    control.onSelect?.(option.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm text-popover-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{option.label}</span>
                    {option.description ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  {option.selected ? (
                    <Check size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function selectedComposerOption(
  control: CloudChatComposerControlView,
): CloudChatComposerControlOptionView | null {
  for (const group of control.groups) {
    const selected = group.options.find((option) => option.selected);
    if (selected) {
      return selected;
    }
  }
  return control.groups[0]?.options[0] ?? null;
}

function iconForComposerControl(
  icon: CloudChatComposerControlView["icon"],
): ComponentType<{ size?: number; className?: string }> {
  switch (icon) {
    case "brain":
      return Brain;
    case "cloud":
      return Terminal;
    case "settings":
      return Wrench;
    case "bot":
    default:
      return Bot;
  }
}

function CloudChatTranscriptRow({ row }: { row: CloudChatTranscriptRowView }) {
  if (row.kind === "user") {
    return (
      <article className="flex justify-end">
        <div className="flex max-w-[77%] flex-col items-end gap-1">
          <div
            className="whitespace-pre-wrap break-words rounded-2xl bg-foreground/5 px-3 py-2 text-sm leading-6 text-foreground"
            data-telemetry-mask
          >
            {row.body}
          </div>
          {row.status || row.streaming ? (
            <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              {row.streaming ? <Loader2 size={12} className="animate-spin" /> : null}
              {row.status ?? "Sending"}
            </div>
          ) : null}
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
