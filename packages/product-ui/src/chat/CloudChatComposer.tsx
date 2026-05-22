import {
  ArrowUp,
  Bot,
  Brain,
  Check,
  ChevronDown,
  Clock3,
  Cloud,
  GitBranch,
  Loader2,
  Terminal,
  Users,
  Wrench,
} from "lucide-react";
import {
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type ComponentType,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { twMerge } from "tailwind-merge";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChatComposerSurface } from "./composer/ChatComposerSurface";
import { ComposerControlButton } from "./composer/ComposerControlButton";
import { ComposerPopoverSurface } from "./composer/ComposerPopoverSurface";
import { ComposerTextarea } from "./composer/ComposerTextarea";
import { ComposerTextareaFrame } from "./composer/ComposerTextareaFrame";

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
  key?: string | null;
  label: string;
  detail?: string | null;
  icon?: "bot" | "brain" | "cloud" | "settings";
  placement?: "leading" | "trailing";
  disabled?: boolean;
  active?: boolean;
  pendingState?: "sending" | "queued" | null;
  groups: readonly CloudChatComposerControlGroupView[];
  onSelect?: (optionId: string) => void;
}

export interface CloudChatComposerView {
  value: string;
  placeholder: string;
  disabled?: boolean;
  canSubmit: boolean;
  isSubmitting?: boolean;
  controls?: readonly CloudChatComposerControlView[];
  footerControls?: readonly CloudChatComposerFooterControlView[];
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export interface CloudChatComposerFooterControlView {
  id: string;
  label: string;
  detail?: string | null;
  icon?: "branch" | "cloud" | "repo" | "users";
  active?: boolean;
  disabled?: boolean;
  pending?: boolean;
  title?: string | null;
  onClick?: () => void;
}

export function CloudChatComposer({ composer }: { composer: CloudChatComposerView }) {
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
    <div className="mx-auto flex max-w-3xl flex-col">
      <ChatComposerSurface>
        <form onSubmit={submitComposer} className="relative flex flex-col">
          <ComposerTextareaFrame topInset="standard">
            <ComposerTextarea
              rows={2}
              value={composer.value}
              onChange={(event) => composer.onChange(event.currentTarget.value)}
              onKeyDown={handleComposerKeyDown}
              disabled={composer.disabled}
              className="min-h-[2.25rem]"
              placeholder={composer.placeholder}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              data-telemetry-mask
            />
          </ComposerTextareaFrame>
          <CloudChatComposerControlRow composer={composer} />
        </form>
      </ChatComposerSurface>
      <CloudChatComposerFooter controls={composer.footerControls ?? []} />
    </div>
  );
}

function CloudChatComposerControlRow({ composer }: { composer: CloudChatComposerView }) {
  const controls = composer.controls ?? [];
  const leadingControls = controls.filter((control) => control.placement === "leading");
  const modelConfigControls = controls.filter((control) => control.placement !== "leading");
  return (
    <div className="mb-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[5px] px-2">
      <div className="flex min-w-0 items-center gap-[5px]">
        {leadingControls.map((control) => (
          <CloudChatSingleControl
            key={control.id}
            control={control}
            composerDisabled={composer.disabled}
          />
        ))}
      </div>

      <div className="min-w-0" aria-hidden="true" />

      <div className="flex min-w-0 items-center gap-[5px]">
        {modelConfigControls.length > 0 ? (
          <CloudChatModelConfigControl
            controls={modelConfigControls}
            composerDisabled={composer.disabled}
          />
        ) : null}
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          aria-label="Send message"
          disabled={!composer.canSubmit || composer.disabled || composer.isSubmitting}
          loading={composer.isSubmitting}
          data-chat-send-button
          className="size-7 rounded-full bg-[var(--color-composer-send-background)] px-0 text-[color:var(--color-composer-send-foreground)] shadow-none hover:bg-[var(--color-composer-send-background)] hover:opacity-90 disabled:cursor-default disabled:opacity-50"
        >
          {composer.isSubmitting ? null : <ArrowUp size={14} />}
        </Button>
      </div>
    </div>
  );
}

function CloudChatComposerFooter({
  controls,
}: {
  controls: readonly CloudChatComposerFooterControlView[];
}) {
  if (controls.length === 0) {
    return null;
  }

  return (
    <div className="rounded-[var(--radius-composer)] px-2 pt-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {controls.map((control) => {
          const Icon = iconForComposerFooterControl(control.icon);
          return (
            <ComposerControlButton
              key={control.id}
              type="button"
              disabled={control.disabled || control.pending}
              active={control.active}
              tone={control.active ? "accent" : "neutral"}
              icon={<Icon size={14} />}
              label={control.label}
              detail={control.detail}
              trailing={control.pending ? (
                <Loader2 size={12} className="shrink-0 animate-spin text-muted-foreground/70" />
              ) : undefined}
              title={control.title ?? undefined}
              className="max-w-full shrink-0 sm:max-w-[18rem]"
              data-telemetry-mask
              onClick={control.onClick}
            />
          );
        })}
      </div>
    </div>
  );
}

function CloudChatSingleControl({
  control,
  composerDisabled = false,
}: {
  control: CloudChatComposerControlView;
  composerDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => selectedComposerOption(control), [control]);
  const disabled = composerDisabled || isControlDisabled(control);
  const Icon = iconForComposerControl(control.icon);
  const displayLabel = selected?.label ?? control.label;
  const displayDetail = control.detail && control.detail !== displayLabel
    ? control.detail
    : null;

  if (disabled) {
    return (
      <ComposerControlButton
        disabled
        tone={control.active ? "accent" : "quiet"}
        active={control.active}
        icon={<Icon size={14} />}
        label={displayLabel}
        detail={displayDetail}
        trailing={<PendingComposerConfigIndicator pendingState={control.pendingState ?? null} />}
        className="max-w-[12rem]"
      />
    );
  }

  return (
    <div className="relative min-w-0">
      <ComposerControlButton
        tone={control.active ? "accent" : "neutral"}
        icon={<Icon size={14} />}
        label={displayLabel}
        detail={displayDetail}
        trailing={(
          <span className="flex items-center gap-1">
            <PendingComposerConfigIndicator pendingState={control.pendingState ?? null} />
            <ChevronDown
              size={12}
              className="shrink-0 text-[color:var(--color-composer-control-muted-foreground)]"
            />
          </span>
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${control.label}: ${displayLabel}${displayDetail ? `, ${displayDetail}` : ""}`}
        data-state={open ? "open" : "closed"}
        className="max-w-[12rem]"
        onClick={() => setOpen((value) => !value)}
      />
      {open ? (
        <ComposerPopoverSurface className="absolute bottom-full left-0 z-30 mb-1 w-56 max-w-[calc(100vw-1rem)] p-1">
          <ComposerControlMenuRows
            control={control}
            onClose={() => setOpen(false)}
          />
        </ComposerPopoverSurface>
      ) : null}
    </div>
  );
}

function CloudChatModelConfigControl({
  controls,
  composerDisabled = false,
}: {
  controls: readonly CloudChatComposerControlView[];
  composerDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const modelControl = controls.find((control) => isModelControl(control)) ?? controls[0] ?? null;
  const configControls = controls.filter((control) => control !== modelControl);
  const selectedModel = modelControl ? selectedComposerOption(modelControl) : null;
  const pendingState = controls.find((control) => control.pendingState)?.pendingState ?? null;
  const disabled = composerDisabled || controls.every(isControlDisabled);
  const triggerLabel = selectedModel?.label ?? modelControl?.detail ?? modelControl?.label ?? "Configure";
  const triggerDetail = summarizeComposerModelConfigControls(configControls);

  return (
    <div className="relative min-w-0">
      <ComposerControlButton
        disabled={disabled}
        icon={<Bot size={16} />}
        label={triggerLabel}
        detail={triggerDetail}
        trailing={(
          <span className="flex items-center gap-1">
            <PendingComposerConfigIndicator pendingState={pendingState} />
            <ChevronDown
              size={12}
              className="shrink-0 text-[color:var(--color-composer-control-muted-foreground)]"
            />
          </span>
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Model and configuration: ${triggerLabel}${triggerDetail ? `, ${triggerDetail}` : ""}`}
        data-state={open ? "open" : "closed"}
        className="max-w-[18rem]"
        onClick={() => setOpen((value) => !value)}
      />
      {open && !disabled ? (
        <ComposerPopoverSurface className="absolute bottom-full right-0 z-30 mb-1 w-72 max-w-[calc(100vw-1rem)] p-1">
          <div className="flex max-h-[min(24rem,calc(100vh-8rem))] min-h-0 flex-col overflow-y-auto">
            {modelControl ? (
              <ComposerControlMenuSection
                control={modelControl}
                showLabel
                onClose={() => setOpen(false)}
              />
            ) : null}
            {configControls.map((control) => (
              <ComposerControlMenuSection
                key={control.id}
                control={control}
                showLabel
                showSeparator
                onClose={() => setOpen(false)}
              />
            ))}
          </div>
        </ComposerPopoverSurface>
      ) : null}
    </div>
  );
}

function ComposerControlMenuSection({
  control,
  showLabel = false,
  showSeparator = false,
  onClose,
}: {
  control: CloudChatComposerControlView;
  showLabel?: boolean;
  showSeparator?: boolean;
  onClose: () => void;
}) {
  return (
    <div>
      {showSeparator ? <ComposerMenuSeparator /> : null}
      {showLabel ? (
        <div className="min-h-5 truncate px-2 py-0.5 text-sm font-[430] leading-4 text-muted-foreground/70">
          {control.label}
        </div>
      ) : null}
      <ComposerControlMenuRows control={control} onClose={onClose} />
    </div>
  );
}

function ComposerControlMenuRows({
  control,
  onClose,
}: {
  control: CloudChatComposerControlView;
  onClose: () => void;
}) {
  return (
    <>
      {control.groups.flatMap((group) =>
        group.options.map((option) => (
          <ComposerMenuItem
            key={`${group.id}:${option.id}`}
            label={option.label}
            trailing={(
              <span className="flex items-center gap-1">
                {option.selected ? <Check size={14} className="shrink-0" /> : null}
                {option.selected ? (
                  <PendingComposerConfigIndicator pendingState={control.pendingState ?? null} />
                ) : null}
              </span>
            )}
            disabled={option.disabled}
            onClick={() => {
              control.onSelect?.(option.id);
              onClose();
            }}
          >
            {option.description}
          </ComposerMenuItem>
        ))
      )}
    </>
  );
}

function ComposerMenuItem({
  label,
  trailing,
  className = "",
  children,
  type = "button",
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  trailing?: ReactNode;
}) {
  const hasDescription = children !== undefined && children !== null && children !== false;
  return (
    <button
      type={type}
      className={twMerge(
        "group/menu-item flex w-full cursor-default select-none flex-col rounded-lg px-2.5 py-1.5 text-sm font-[430] leading-5 text-popover-foreground outline-none transition-colors hover:bg-popover-accent focus:bg-popover-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
        className,
      )}
      {...props}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      <span className="flex w-full items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {trailing ? (
          <span className="flex shrink-0 items-center justify-center text-muted-foreground opacity-75 transition-opacity group-hover/menu-item:opacity-100 group-focus/menu-item:opacity-100 [&_*]:text-xs [&_*]:leading-4">
            {trailing}
          </span>
        ) : null}
      </span>
      {hasDescription ? (
        <span className="mt-0.5 flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 text-left text-xs leading-4 text-muted-foreground [&>*]:!mt-0 [&_*]:text-xs [&_*]:leading-4">
            {children}
          </span>
        </span>
      ) : null}
    </button>
  );
}

function ComposerMenuSeparator() {
  return <div className="mx-2 my-1 border-t border-border/60" />;
}

function PendingComposerConfigIndicator({
  pendingState,
}: {
  pendingState: CloudChatComposerControlView["pendingState"];
}) {
  if (pendingState === "sending") {
    return <Loader2 size={12} className="shrink-0 animate-spin text-muted-foreground/70" />;
  }
  if (pendingState === "queued") {
    return <Clock3 size={12} className="shrink-0 text-muted-foreground/70" />;
  }
  return null;
}

function summarizeComposerModelConfigControls(
  controls: readonly CloudChatComposerControlView[],
): string | null {
  const labels = controls.flatMap((control) => {
    const selected = selectedComposerOption(control);
    if ((control.key === "fast_mode" || control.key === "reasoning") && !control.active) {
      return [];
    }
    return [selected?.label ?? control.detail].filter((label): label is string => Boolean(label));
  });
  return labels.length > 0 ? labels.slice(0, 3).join(" · ") : null;
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

function isModelControl(control: CloudChatComposerControlView): boolean {
  return control.key === "model" || control.id === "launch-model" || control.label === "Model";
}

function isControlDisabled(control: CloudChatComposerControlView): boolean {
  return control.disabled || control.groups.every((group) =>
    group.options.every((option) => option.disabled)
  );
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

function iconForComposerFooterControl(
  icon: CloudChatComposerFooterControlView["icon"],
): ComponentType<{ size?: number; className?: string }> {
  switch (icon) {
    case "branch":
      return GitBranch;
    case "users":
      return Users;
    case "cloud":
    case "repo":
    default:
      return Cloud;
  }
}
