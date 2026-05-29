import {
  ArrowUp,
  Bot,
  Brain,
  Check,
  ChevronDown,
  Clock3,
  Cloud,
  ExternalLink,
  GitBranch,
  Globe,
  Loader2,
  Plus,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import type { SessionControlIconKey } from "@proliferate/product-domain/chats/session-controls/presentation";
import { Input } from "@proliferate/ui/primitives/Input";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { twMerge } from "tailwind-merge";
import { PopoverMenuItem } from "../popover/PopoverMenuItem";
import { ChatComposerControlRowFrame } from "./composer/ChatComposerControlRowFrame";
import { ChatComposerSurface } from "./composer/ChatComposerSurface";
import { ComposerActionButton } from "./composer/ComposerActionButton";
import { ComposerControlButton } from "./composer/ComposerControlButton";
import { ComposerPopoverSurface } from "./composer/ComposerPopoverSurface";
import { ComposerTextarea } from "./composer/ComposerTextarea";
import { ComposerTextareaFrame } from "./composer/ComposerTextareaFrame";
import { SessionControlIcon } from "./session-controls/SessionControlIcon";

export interface CloudChatComposerControlOptionView {
  id: string;
  label: string;
  description?: string | null;
  icon?: SessionControlIconKey | null;
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
  icon?: "bot" | "brain" | "settings" | SessionControlIconKey;
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
  footerComposerControls?: readonly CloudChatComposerControlView[];
  footerControls?: readonly CloudChatComposerFooterControlView[];
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export interface CloudChatComposerFooterControlView {
  id: string;
  label: string;
  detail?: string | null;
  icon?: "branch" | "cloud" | "external" | "globe" | "repo" | "sparkles" | "users";
  active?: boolean;
  disabled?: boolean;
  pending?: boolean;
  title?: string | null;
  onClick?: () => void;
}

export interface CloudChatComposerControlStripProps {
  controls: readonly CloudChatComposerControlView[];
  disabled?: boolean;
  className?: string;
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
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <ChatComposerSurface overflowMode="visible">
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
      <CloudChatComposerFooter
        composerControls={composer.footerComposerControls ?? []}
        controls={composer.footerControls ?? []}
        disabled={composer.disabled}
      />
    </div>
  );
}

function CloudChatComposerControlRow({ composer }: { composer: CloudChatComposerView }) {
  const leadingControls = (composer.controls ?? []).filter((control) => control.placement === "leading");
  const modelConfigControls = (composer.controls ?? []).filter((control) => control.placement !== "leading");

  return (
    <ChatComposerControlRowFrame
      leading={(
        <>
          <ComposerControlButton
            type="button"
            icon={<Plus size={17} />}
            iconOnly
            label="Add context"
            disabled={composer.disabled}
            className="text-[color:var(--color-composer-control-foreground)]"
          />
          {leadingControls.map((control) => (
            <CloudChatSingleControl
              key={control.id}
              control={control}
              composerDisabled={composer.disabled}
            />
          ))}
        </>
      )}
      trailing={(
        modelConfigControls.length > 0 ? (
          <CloudChatModelConfigControl
            controls={modelConfigControls}
            composerDisabled={composer.disabled}
          />
        ) : null
      )}
      action={(
        <ComposerActionButton
          type="submit"
          aria-label="Send message"
          disabled={!composer.canSubmit || composer.disabled || composer.isSubmitting}
          loading={composer.isSubmitting}
          data-chat-send-button
        >
          {composer.isSubmitting ? null : <ArrowUp size={14} />}
        </ComposerActionButton>
      )}
    />
  );
}

export function CloudChatComposerControlStrip({
  controls,
  disabled = false,
  className = "",
}: CloudChatComposerControlStripProps) {
  const leadingControls = controls.filter((control) => control.placement === "leading");
  const modelConfigControls = controls.filter((control) => control.placement !== "leading");
  return (
    <div
      className={twMerge(
        "grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[5px]",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-[5px]">
        {leadingControls.map((control) => (
          <CloudChatSingleControl
            key={control.id}
            control={control}
            composerDisabled={disabled}
          />
        ))}
      </div>

      <div className="min-w-0" aria-hidden="true" />

      <div className="flex min-w-0 items-center gap-[5px]">
        {modelConfigControls.length > 0 ? (
          <CloudChatModelConfigControl
            controls={modelConfigControls}
            composerDisabled={disabled}
          />
        ) : null}
      </div>
    </div>
  );
}

function CloudChatComposerFooter({
  composerControls,
  controls,
  disabled = false,
}: {
  composerControls: readonly CloudChatComposerControlView[];
  controls: readonly CloudChatComposerFooterControlView[];
  disabled?: boolean;
}) {
  if (composerControls.length === 0 && controls.length === 0) {
    return null;
  }

  return (
    <div className="rounded-[var(--radius-composer,1.5rem)] px-2 pt-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {composerControls.map((control) => (
          <CloudChatSingleControl
            key={control.id}
            control={control}
            composerDisabled={disabled}
          />
        ))}
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
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = useMemo(() => selectedComposerOption(control), [control]);
  const disabled = composerDisabled || isControlDisabled(control);
  const icon = iconNodeForComposerControl(selected?.icon ?? control.icon, "size-3.5");
  const displayLabel = selected?.label ?? control.label;
  const displayDetail = control.detail && control.detail !== displayLabel
    ? control.detail
    : null;
  const searchable = composerControlOptionCount(control) > 12;
  const visibleControl = searchable ? filterComposerControlOptions(control, search) : control;

  function closePopover() {
    setOpen(false);
    setSearch("");
  }

  useDismissComposerPopover(open, rootRef, closePopover);

  if (disabled) {
    return (
      <ComposerControlButton
        disabled
        tone={control.active ? "accent" : "quiet"}
        active={control.active}
        icon={icon}
        label={displayLabel}
        detail={displayDetail}
        trailing={<PendingComposerConfigIndicator pendingState={control.pendingState ?? null} />}
        className="max-w-[12rem]"
      />
    );
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <ComposerControlButton
        tone={control.active ? "accent" : "neutral"}
        icon={icon}
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
        onClick={() => {
          setOpen((value) => {
            const nextOpen = !value;
            if (!nextOpen) {
              setSearch("");
            }
            return nextOpen;
          });
        }}
      />
      {open ? (
        <ComposerPopoverSurface className="absolute bottom-full left-0 z-30 mb-1 w-64 max-w-[calc(100vw-1rem)] p-1">
          {searchable ? (
            <div className="px-1 pb-1">
              <div className="flex h-7 items-center rounded-lg border border-border bg-surface-control px-2.5">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={`Search ${control.label.toLowerCase()}`}
                  className="h-auto min-w-0 border-0 bg-transparent px-0 py-0 text-sm shadow-none focus:ring-0"
                  data-telemetry-mask
                />
              </div>
            </div>
          ) : null}
          <div className="max-h-[min(18rem,calc(100vh-8rem))] overflow-y-auto">
            {composerControlOptionCount(visibleControl) > 0 ? (
              <ComposerControlMenuRows
                control={visibleControl}
                onClose={() => {
                  setOpen(false);
                  setSearch("");
                }}
              />
            ) : (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                No matches
              </p>
            )}
          </div>
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
  const [search, setSearch] = useState("");
  const [activeSubmenuId, setActiveSubmenuId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const modelControl = controls.find((control) => isModelControl(control)) ?? controls[0] ?? null;
  const configControls = controls.filter((control) => control !== modelControl);
  const selectedModel = modelControl ? selectedComposerOption(modelControl) : null;
  const filteredModelControl = modelControl
    ? filterModelControlOptions(modelControl, search)
    : null;
  const activeConfigSubmenuControl = configControls.find((control) => control.id === activeSubmenuId) ?? null;
  const showSubmenuRows = configControls.length > 0;
  const pendingState = controls.find((control) => control.pendingState)?.pendingState ?? null;
  const disabled = composerDisabled || controls.every(isControlDisabled);
  const triggerLabel = selectedModel?.label ?? modelControl?.detail ?? modelControl?.label ?? "Configure";
  const triggerDetail = summarizeComposerModelConfigControls(configControls);

  function closePopover() {
    setOpen(false);
    setSearch("");
    setActiveSubmenuId(null);
  }

  useDismissComposerPopover(open, rootRef, closePopover);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <ComposerControlButton
        disabled={disabled}
        icon={iconNodeForComposerControl(selectedModel?.icon ?? modelControl?.icon ?? "claude", "size-4")}
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
        onClick={() => {
          setOpen((value) => {
            const nextOpen = !value;
            if (!nextOpen) {
              setSearch("");
              setActiveSubmenuId(null);
            }
            return nextOpen;
          });
        }}
      />
      {open && !disabled ? (
        <div
          className="absolute bottom-full right-0 z-[80] mb-1"
          onMouseLeave={() => setActiveSubmenuId(null)}
        >
          <ComposerPopoverSurface className="w-72 max-w-[calc(100vw-1rem)] p-1">
            <div className="flex max-h-[min(20rem,calc(100vh-8rem))] min-h-0 flex-col">
              {modelControl ? (
                <ComposerModelPickerMenu
                  control={filteredModelControl ?? modelControl}
                  search={search}
                  onSearchChange={setSearch}
                  onClose={() => {
                    setOpen(false);
                    setSearch("");
                    setActiveSubmenuId(null);
                  }}
                />
              ) : null}
              {showSubmenuRows ? (
                <div className="shrink-0">
                  <ComposerMenuSeparator />
                  {configControls.map((control) => (
                    <ComposerConfigSubmenuButton
                      key={control.id}
                      active={activeSubmenuId === control.id}
                      control={control}
                      onOpen={() => setActiveSubmenuId(control.id)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </ComposerPopoverSurface>
          {activeConfigSubmenuControl ? (
            <ComposerPopoverSurface className="absolute bottom-0 left-[calc(100%+0.25rem)] z-[81] w-56 max-w-[calc(100vw-1rem)] p-1">
              <ComposerControlMenuRows
                control={activeConfigSubmenuControl}
                onClose={() => {
                  setOpen(false);
                  setSearch("");
                  setActiveSubmenuId(null);
                }}
              />
            </ComposerPopoverSurface>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ComposerModelPickerMenu({
  control,
  search,
  onSearchChange,
  onClose,
}: {
  control: CloudChatComposerControlView;
  search: string;
  onSearchChange: (value: string) => void;
  onClose: () => void;
}) {
  const hasModelOptions = control.groups.some((group) => group.options.length > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-1">
      <div className="space-y-1">
        <div className="px-1">
          <div className="flex h-7 items-center rounded-lg border border-border bg-surface-control px-2.5">
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search models"
              className="h-auto min-w-0 border-0 bg-transparent px-0 py-0 text-sm shadow-none focus:ring-0"
              data-telemetry-mask
            />
          </div>
        </div>
      </div>
      <div className="min-h-0 max-h-[11rem] overflow-y-auto">
        {control.groups.map((group, index) => (
          <div key={group.id}>
            {index > 0 ? <ComposerMenuSeparator /> : null}
            {modelGroupLabel(control, group) ? (
              <div className="min-h-5 truncate px-2 py-0.5 text-sm font-[430] leading-4 text-muted-foreground/70">
                {modelGroupLabel(control, group)}
              </div>
            ) : null}
            <ComposerControlMenuRows
              control={{ ...control, groups: [group] }}
              showDescriptions={!isModelControl(control)}
              onClose={onClose}
            />
          </div>
        ))}
        {!hasModelOptions ? (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">
            No models matching "{search}"
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ComposerConfigSubmenuButton({
  active,
  control,
  onOpen,
}: {
  active: boolean;
  control: CloudChatComposerControlView;
  onOpen: () => void;
}) {
  return (
    <PopoverMenuItem
      label={modelConfigSubmenuLabel(control)}
      trailing={<ChevronDown className="-rotate-90 size-3.5 shrink-0" />}
      className={active ? "bg-popover-accent text-popover-foreground" : ""}
      aria-haspopup="menu"
      aria-expanded={active}
      data-state={active ? "open" : "closed"}
      onClick={onOpen}
      onFocus={onOpen}
      onMouseEnter={onOpen}
    />
  );
}

function ComposerControlMenuRows({
  control,
  showDescriptions = true,
  onClose,
}: {
  control: CloudChatComposerControlView;
  showDescriptions?: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {control.groups.flatMap((group) =>
        group.options.map((option) => (
          <PopoverMenuItem
            key={`${group.id}:${option.id}`}
            label={option.label}
            icon={option.icon ? <SessionControlIcon icon={option.icon} className="size-3.5" /> : undefined}
            trailing={(
              <span className="flex items-center gap-1">
                {option.selected ? <Check className="size-3.5 shrink-0" /> : null}
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
            {showDescriptions ? option.description : null}
          </PopoverMenuItem>
        ))
      )}
    </>
  );
}

function ComposerMenuSeparator() {
  return (
    <div className="w-full px-2 py-0.5">
      <div className="h-px w-full bg-border/60" />
    </div>
  );
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

function filterModelControlOptions(
  control: CloudChatComposerControlView,
  search: string,
): CloudChatComposerControlView {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) {
    return control;
  }

  return {
    ...control,
    groups: control.groups.flatMap((group) => {
      const groupMatches = (group.label ?? group.id).toLowerCase().includes(normalizedSearch);
      const options = groupMatches
        ? group.options
        : group.options.filter((option) =>
          `${option.label} ${option.description ?? ""}`.toLowerCase().includes(normalizedSearch)
        );
      return options.length > 0 ? [{ ...group, options }] : [];
    }),
  };
}

function filterComposerControlOptions(
  control: CloudChatComposerControlView,
  search: string,
): CloudChatComposerControlView {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) {
    return control;
  }

  return {
    ...control,
    groups: control.groups.flatMap((group) => {
      const groupMatches = (group.label ?? group.id).toLowerCase().includes(normalizedSearch);
      const options = groupMatches
        ? group.options
        : group.options.filter((option) =>
          `${option.label} ${option.description ?? ""}`.toLowerCase().includes(normalizedSearch)
        );
      return options.length > 0 ? [{ ...group, options }] : [];
    }),
  };
}

function composerControlOptionCount(control: CloudChatComposerControlView): number {
  return control.groups.reduce((count, group) => count + group.options.length, 0);
}

function useDismissComposerPopover(
  open: boolean,
  rootRef: { readonly current: HTMLElement | null },
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const ownerDocument = rootRef.current?.ownerDocument ?? document;

    function eventTargetIsInsideRoot(target: EventTarget | null): boolean {
      return target instanceof Node
        && Boolean(rootRef.current?.contains(target));
    }

    function handlePointerDown(event: PointerEvent) {
      if (!eventTargetIsInsideRoot(event.target)) {
        onClose();
      }
    }

    function handleFocusIn(event: FocusEvent) {
      if (!eventTargetIsInsideRoot(event.target)) {
        onClose();
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    ownerDocument.addEventListener("pointerdown", handlePointerDown, true);
    ownerDocument.addEventListener("focusin", handleFocusIn, true);
    ownerDocument.addEventListener("keydown", handleKeyDown, true);
    return () => {
      ownerDocument.removeEventListener("pointerdown", handlePointerDown, true);
      ownerDocument.removeEventListener("focusin", handleFocusIn, true);
      ownerDocument.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose, open, rootRef]);
}

function modelConfigSubmenuLabel(control: CloudChatComposerControlView): string {
  switch (control.key) {
    case "effort":
    case "reasoning":
      return "Reasoning";
    case "fast_mode":
      return "Speed";
    case "model":
      if (control.groups.length > 1) {
        return "Agent";
      }
      return activeComposerModelGroup(control)?.label ?? selectedComposerOption(control)?.label ?? control.label;
    default:
      return control.label;
  }
}

function activeComposerModelGroup(
  control: CloudChatComposerControlView,
): CloudChatComposerControlGroupView | null {
  return control.groups.find((group) =>
    group.options.some((option) => option.selected)
  ) ?? control.groups[0] ?? null;
}

function modelGroupLabel(
  control: CloudChatComposerControlView,
  group: CloudChatComposerControlGroupView,
): string | null {
  const label = group.label ?? null;
  if (!isModelControl(control)) {
    return label;
  }
  if (label && label !== "Model") {
    return label;
  }

  const optionText = group.options
    .map((option) => `${option.label} ${option.description ?? ""}`)
    .join(" ")
    .toLowerCase();
  if (optionText.includes("sonnet") || optionText.includes("haiku") || optionText.includes("claude")) {
    return "Claude";
  }

  return label;
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

function iconNodeForComposerControl(
  icon: CloudChatComposerControlView["icon"],
  className: string,
): ReactNode {
  switch (icon) {
    case "brain":
      return <Brain size={14} className={className} />;
    case "settings":
      return <Wrench size={14} className={className} />;
    case "bot":
      return <Bot size={14} className={className} />;
    case undefined:
    case null:
      return <Bot size={14} className={className} />;
    default:
      return <SessionControlIcon icon={icon} className={className} />;
  }
}

function iconForComposerFooterControl(
  icon: CloudChatComposerFooterControlView["icon"],
): ComponentType<{ size?: number; className?: string }> {
  switch (icon) {
    case "branch":
      return GitBranch;
    case "external":
      return ExternalLink;
    case "globe":
      return Globe;
    case "sparkles":
      return Sparkles;
    case "users":
      return Users;
    case "cloud":
    case "repo":
    default:
      return Cloud;
  }
}
