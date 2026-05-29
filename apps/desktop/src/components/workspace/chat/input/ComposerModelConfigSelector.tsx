import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { AgentSetupModal } from "@/components/agents/AgentSetupModal";
import { Input } from "@proliferate/ui/primitives/Input";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import {
  Check,
  ChevronDown,
} from "@proliferate/ui/icons";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { CHAT_MODEL_SELECTOR_LABELS } from "@/copy/chat/chat-copy";
import {
  resolveReasoningEffortPresentation,
} from "@/lib/domain/chat/session-controls/session-reasoning-effort-control";
import {
  resolveConfiguredSessionControlValue,
  resolveSessionControlPresentation,
} from "@/lib/domain/chat/session-controls/session-mode-control";
import {
  summarizeComposerModelConfigControls,
} from "@/lib/domain/chat/session-controls/composer-control-groups";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import type {
  ModelSelectorGroup,
  ModelSelectorProps,
  ModelSelectorSelection,
} from "@/lib/domain/chat/models/model-selection";
import { ComposerControlButton } from "@proliferate/product-ui/chat/composer/ComposerControlButton";
import { ComposerPopoverSurface } from "@proliferate/product-ui/chat/composer/ComposerPopoverSurface";
import { PendingConfigIndicator } from "./PendingConfigIndicator";

interface ComposerModelConfigSelectorProps {
  modelSelectorProps: ModelSelectorProps;
  agentKind: string | null;
  controls: LiveSessionControlDescriptor[];
}

type ComposerConfigSubmenu =
  | { kind: "harness" }
  | { kind: "control"; key: LiveSessionControlDescriptor["key"] };

const COMPOSER_SUBMENU_GAP_PX = 4;
const COMPOSER_SUBMENU_VIEWPORT_MARGIN_PX = 8;

interface ComposerSubmenuPosition {
  left: number;
  top: number;
}

export function ComposerModelConfigSelector({
  modelSelectorProps,
  agentKind,
  controls,
}: ComposerModelConfigSelectorProps) {
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const [search, setSearch] = useState("");
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<ComposerConfigSubmenu | null>(null);
  const [submenuAnchorTop, setSubmenuAnchorTop] = useState<number | null>(null);
  const [submenuPosition, setSubmenuPosition] = useState<ComposerSubmenuPosition | null>(null);
  const [setupAgent, setSetupAgent] = useState<ModelSelectorProps["notReadyAgents"][number] | null>(null);
  const {
    connectionState,
    currentModel,
    groups,
    hasAgents,
    isLoading,
    notReadyAgents,
    onSelect,
  } = modelSelectorProps;
  const selectorEnabled = connectionState === "healthy" && !isLoading && hasAgents;
  const activeKind = currentModel?.kind ?? null;
  const activeGroup = activeKind
    ? groups.find((group) => group.kind === activeKind) ?? null
    : groups[0] ?? null;
  const activeModelGroups = useMemo(
    () => activeGroup ? [activeGroup] : [],
    [activeGroup],
  );
  const harnessLabel =
    activeGroup?.providerDisplayName
    ?? currentModel?.kind
    ?? "Harness";
  const triggerLabel = resolveTriggerLabel(modelSelectorProps);
  const triggerDetail = summarizeComposerModelConfigControls(agentKind, controls);
  const pendingState =
    currentModel?.pendingState
    ?? controls.find((control) => control.pendingState)?.pendingState
    ?? null;
  const filteredGroups = useMemo(
    () => filterModelGroups(activeModelGroups, search),
    [activeModelGroups, search],
  );
  const submenuControls = useMemo(
    () => sortComposerConfigSubmenuControls(controls),
    [controls],
  );

  useLayoutEffect(() => {
    if (!activeSubmenu) {
      setSubmenuAnchorTop(null);
      setSubmenuPosition(null);
      return;
    }

    const updateSubmenuPosition = () => {
      const root = menuRootRef.current;
      const submenu = submenuRef.current;
      if (!root || !submenu) {
        return;
      }

      const rootRect = root.getBoundingClientRect();
      const submenuRect = submenu.getBoundingClientRect();
      const viewportLeft = window.visualViewport?.offsetLeft ?? 0;
      const viewportTop = window.visualViewport?.offsetTop ?? 0;
      const viewportRight = viewportLeft + (
        window.visualViewport?.width
        ?? document.documentElement.clientWidth
        ?? window.innerWidth
      );
      const viewportBottom = viewportTop + (
        window.visualViewport?.height
        ?? document.documentElement.clientHeight
        ?? window.innerHeight
      );
      const preferredRightLeft = rootRect.width + COMPOSER_SUBMENU_GAP_PX;
      const preferredLeftLeft = -submenuRect.width - COMPOSER_SUBMENU_GAP_PX;
      const rightFits = rootRect.right + COMPOSER_SUBMENU_GAP_PX + submenuRect.width
        <= viewportRight - COMPOSER_SUBMENU_VIEWPORT_MARGIN_PX;
      const leftFits = rootRect.left - COMPOSER_SUBMENU_GAP_PX - submenuRect.width
        >= viewportLeft + COMPOSER_SUBMENU_VIEWPORT_MARGIN_PX;
      const preferredLeft = rightFits || !leftFits ? preferredRightLeft : preferredLeftLeft;
      const minLeft = viewportLeft + COMPOSER_SUBMENU_VIEWPORT_MARGIN_PX - rootRect.left;
      const maxLeft = viewportRight
        - COMPOSER_SUBMENU_VIEWPORT_MARGIN_PX
        - rootRect.left
        - submenuRect.width;
      const preferredTop = submenuAnchorTop ?? 0;
      const minTop = viewportTop + COMPOSER_SUBMENU_VIEWPORT_MARGIN_PX - rootRect.top;
      const maxTop = viewportBottom
        - COMPOSER_SUBMENU_VIEWPORT_MARGIN_PX
        - rootRect.top
        - submenuRect.height;

      setSubmenuPosition({
        left: clamp(
          preferredLeft,
          Math.min(minLeft, maxLeft),
          Math.max(minLeft, maxLeft),
        ),
        top: clamp(
          preferredTop,
          Math.min(minTop, maxTop),
          Math.max(minTop, maxTop),
        ),
      });
    };

    updateSubmenuPosition();
    window.addEventListener("resize", updateSubmenuPosition);
    return () => window.removeEventListener("resize", updateSubmenuPosition);
  }, [activeSubmenu, submenuAnchorTop]);

  if (!selectorEnabled) {
    return (
      <ComposerControlButton
        disabled
        tone="quiet"
        icon={currentModel ? <ProviderIcon kind={currentModel.kind} className="size-4 shrink-0" /> : undefined}
        label={triggerLabel}
        detail={triggerDetail}
        className="max-w-[15rem]"
      />
    );
  }

  return (
    <>
      <PopoverButton
        trigger={(
          <ComposerControlButton
            icon={currentModel ? <ProviderIcon kind={currentModel.kind} className="size-4 shrink-0" /> : undefined}
            label={triggerLabel}
            detail={triggerDetail}
            trailing={(
              <span className="flex items-center gap-1">
                <PendingConfigIndicator pendingState={pendingState} />
                <ChevronDown className="size-3 shrink-0 text-[color:var(--color-composer-control-muted-foreground)]" />
              </span>
            )}
            aria-label={`Model and configuration: ${triggerLabel}${triggerDetail ? `, ${triggerDetail}` : ""}`}
            className="max-w-[18rem]"
          />
        )}
        side="top"
        align="end"
        offset={2}
        className="w-auto border-0 bg-transparent p-0 shadow-none"
        onOpenChange={(open) => {
          if (!open) {
            setSearch("");
            setAddProviderOpen(false);
            setActiveSubmenu(null);
            setSubmenuAnchorTop(null);
            setSubmenuPosition(null);
          }
        }}
      >
        {(close) => {
          const activeControl = activeSubmenu?.kind === "control"
            ? submenuControls.find((control) => control.key === activeSubmenu.key) ?? null
            : null;
          const showHarnessSubmenu = groups.length > 1;
          const showSubmenuRows = submenuControls.length > 0 || showHarnessSubmenu;

          return (
            <div
              ref={menuRootRef}
              className="relative w-72 max-w-[calc(100vw-1rem)]"
              onMouseLeave={() => setActiveSubmenu(null)}
            >
              <ComposerPopoverSurface className="w-72 max-w-[calc(100vw-1rem)] p-1">
                <div className="flex max-h-[min(20rem,calc(100vh-8rem))] min-h-0 flex-col">
                  <ComposerModelPickerContent
                    filteredGroups={filteredGroups}
                    groups={activeModelGroups}
                    search={search}
                    onSearchChange={setSearch}
                    onSelect={(selection) => {
                      onSelect(selection);
                      close();
                    }}
                  />

                  {(showSubmenuRows || notReadyAgents.length > 0) && (
                    <div className="shrink-0">
                      <ComposerMenuSeparator />

                      {notReadyAgents.length > 0 && (
                        <ComposerAddProviderRows
                          addProviderOpen={addProviderOpen}
                          notReadyAgents={notReadyAgents}
                          onAddProviderOpenChange={setAddProviderOpen}
                          onSetupAgent={setSetupAgent}
                        />
                      )}

                      {showHarnessSubmenu && (
                        <ComposerSubmenuMenuItem
                          active={activeSubmenu?.kind === "harness"}
                          label={harnessLabel}
                          onOpen={(anchorElement) => {
                            setAddProviderOpen(false);
                            setSubmenuPosition(null);
                            setSubmenuAnchorTop(resolveSubmenuAnchorTop(menuRootRef.current, anchorElement));
                            setActiveSubmenu({ kind: "harness" });
                          }}
                        />
                      )}

                      {submenuControls.map((control) => (
                        <ComposerSubmenuMenuItem
                          key={control.key}
                          active={activeSubmenu?.kind === "control" && activeSubmenu.key === control.key}
                          label={resolveControlSubmenuLabel(control)}
                          onOpen={(anchorElement) => {
                            setAddProviderOpen(false);
                            setSubmenuPosition(null);
                            setSubmenuAnchorTop(resolveSubmenuAnchorTop(menuRootRef.current, anchorElement));
                            setActiveSubmenu({ kind: "control", key: control.key });
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </ComposerPopoverSurface>

              <div
                ref={submenuRef}
                className="absolute z-10"
                style={{
                  left: submenuPosition?.left ?? 0,
                  top: submenuPosition?.top ?? 0,
                  visibility: activeSubmenu && submenuPosition === null ? "hidden" : undefined,
                }}
              >
                {activeSubmenu?.kind === "harness" && (
                  <ComposerHarnessSubmenu
                    activeKind={activeKind}
                    groups={groups}
                    onSelect={(selection) => {
                      onSelect(selection);
                      close();
                    }}
                  />
                )}

                {activeControl && (
                  <ComposerControlSubmenu
                    agentKind={agentKind}
                    control={activeControl}
                    onClose={close}
                  />
                )}
              </div>
            </div>
          );
        }}
      </PopoverButton>

      {setupAgent && (
        <AgentSetupModal
          agent={setupAgent}
          onClose={() => setSetupAgent(null)}
        />
      )}
    </>
  );
}

function ComposerConfigControlRows({
  agentKind,
  control,
  onClose,
}: {
  agentKind: string | null;
  control: LiveSessionControlDescriptor;
  onClose: () => void;
}) {
  return (
    <>
      {control.options.map((option) => {
        return (
          <PopoverMenuItem
            key={option.value}
            label={resolveControlOptionLabel(agentKind, control, option.value, option.label)}
            trailing={
              <span className="flex items-center gap-1">
                {option.selected && <Check className="size-3.5 shrink-0" />}
                {option.selected && <PendingConfigIndicator pendingState={control.pendingState} />}
              </span>
            }
            disabled={!control.settable}
            onClick={() => {
              control.onSelect(option.value);
              onClose();
            }}
          >
            {resolveControlOptionDescription(agentKind, control, option.value, option.description)}
          </PopoverMenuItem>
        );
      })}
    </>
  );
}

function ComposerSubmenuMenuItem({
  active,
  icon,
  label,
  onOpen,
}: {
  active: boolean;
  icon?: ReactNode;
  label: string;
  onOpen: (anchorElement: HTMLElement) => void;
}) {
  return (
    <PopoverMenuItem
      aria-expanded={active}
      aria-haspopup="menu"
      className={active ? "bg-popover-accent text-popover-foreground" : ""}
      data-state={active ? "open" : "closed"}
      icon={icon}
      label={label}
      trailing={<ChevronDown className="-rotate-90 size-3.5 shrink-0" />}
      onClick={(event) => onOpen(event.currentTarget)}
      onFocus={(event) => onOpen(event.currentTarget)}
      onMouseEnter={(event) => onOpen(event.currentTarget)}
    />
  );
}

function ComposerControlSubmenu({
  agentKind,
  control,
  onClose,
}: {
  agentKind: string | null;
  control: LiveSessionControlDescriptor;
  onClose: () => void;
}) {
  return (
    <ComposerPopoverSurface className="w-56 max-w-[calc(100vw-1rem)] p-1">
      <ComposerConfigControlRows
        agentKind={agentKind}
        control={control}
        onClose={onClose}
      />
    </ComposerPopoverSurface>
  );
}

function ComposerModelPickerContent({
  filteredGroups,
  groups,
  search,
  onSearchChange,
  onSelect,
}: {
  filteredGroups: ModelSelectorGroup[];
  groups: ModelSelectorGroup[];
  search: string;
  onSearchChange: (search: string) => void;
  onSelect: (selection: ModelSelectorSelection) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-1">
      <div className="space-y-1">
        <div className="px-1">
          <div className="flex h-7 items-center rounded-lg border border-border bg-surface-control px-2.5">
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={CHAT_MODEL_SELECTOR_LABELS.searchPlaceholder}
              className="h-auto min-w-0 border-0 bg-transparent px-0 py-0 text-sm shadow-none focus:ring-0"
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 max-h-[11rem] overflow-y-auto">
        {filteredGroups.map((group, index) => (
          <ComposerModelGroup
            key={group.kind}
            group={group}
            showSeparator={index > 0}
            onSelect={onSelect}
          />
        ))}

        {filteredGroups.length === 0 && groups.length > 0 && (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">
            {CHAT_MODEL_SELECTOR_LABELS.noMatchPrefix} "{search}"
          </p>
        )}

        {groups.length === 0 && (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">
            {CHAT_MODEL_SELECTOR_LABELS.noProviders}
          </p>
        )}
      </div>
    </div>
  );
}

function ComposerAddProviderRows({
  addProviderOpen,
  notReadyAgents,
  onAddProviderOpenChange,
  onSetupAgent,
}: {
  addProviderOpen: boolean;
  notReadyAgents: ModelSelectorProps["notReadyAgents"];
  onAddProviderOpenChange: Dispatch<SetStateAction<boolean>>;
  onSetupAgent: (agent: ModelSelectorProps["notReadyAgents"][number]) => void;
}) {
  return (
    <>
      <PopoverMenuItem
        label={CHAT_MODEL_SELECTOR_LABELS.addProvider}
        trailing={<ChevronDown className={`size-3.5 shrink-0 transition-transform ${addProviderOpen ? "rotate-180" : ""}`} />}
        onClick={() => onAddProviderOpenChange((open) => !open)}
      />
      {addProviderOpen && notReadyAgents.map((agent) => (
        <PopoverMenuItem
          key={agent.kind}
          label={agent.displayName}
          trailing={<span className="text-xs text-muted-foreground">Setup</span>}
          className="ml-2 w-[calc(100%-0.5rem)]"
          onClick={() => onSetupAgent(agent)}
        />
      ))}
    </>
  );
}

function ComposerHarnessSubmenu({
  activeKind,
  groups,
  onSelect,
}: {
  activeKind: string | null;
  groups: ModelSelectorGroup[];
  onSelect: (selection: ModelSelectorSelection) => void;
}) {
  return (
    <ComposerPopoverSurface className="w-56 max-w-[calc(100vw-1rem)] p-1">
      {groups.map((group) => (
        <PopoverMenuItem
          key={group.kind}
          icon={<ProviderIcon kind={group.kind} className="size-3.5 shrink-0" />}
          label={group.providerDisplayName}
          trailing={
            group.kind === activeKind
              ? <Check className="size-3.5 shrink-0" />
              : null
          }
          disabled={group.models.length === 0}
          onClick={() => {
            const selection = resolveHarnessSelection(group);
            if (selection) {
              onSelect(selection);
            }
          }}
        />
      ))}
    </ComposerPopoverSurface>
  );
}

function ComposerModelGroup({
  group,
  showSeparator,
  onSelect,
}: {
  group: ModelSelectorGroup;
  showSeparator: boolean;
  onSelect: (selection: ModelSelectorSelection) => void;
}) {
  return (
    <>
      {showSeparator && <div className="mx-2 my-1 border-t border-border/60" />}
      <div className="min-h-5 truncate px-2 py-0.5 text-sm font-[430] leading-4 text-muted-foreground/70">
        {group.providerDisplayName}
      </div>
      {group.models.map((model) => (
        <PopoverMenuItem
          key={model.modelId}
          label={model.displayName}
          trailing={
            <span className="flex items-center gap-1">
              {model.actionKind === "open_new_chat" && !model.isSelected && (
                <span className="text-xs text-muted-foreground/70">
                  {CHAT_MODEL_SELECTOR_LABELS.newChatBadge}
                </span>
              )}
              {model.isSelected && <Check className="size-3.5 shrink-0" />}
            </span>
          }
          onClick={() => onSelect({ kind: group.kind, modelId: model.modelId })}
        />
      ))}
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

function resolveSubmenuAnchorTop(
  root: HTMLElement | null,
  anchorElement: HTMLElement,
): number {
  if (!root) {
    return 0;
  }
  const rootRect = root.getBoundingClientRect();
  const anchorRect = anchorElement.getBoundingClientRect();
  return anchorRect.top - rootRect.top;
}

function sortComposerConfigSubmenuControls(
  controls: LiveSessionControlDescriptor[],
): LiveSessionControlDescriptor[] {
  const order: Partial<Record<LiveSessionControlDescriptor["key"], number>> = {
    effort: 0,
    reasoning: 1,
    fast_mode: 2,
    mode: 3,
    collaboration_mode: 4,
  };

  return [...controls].sort((left, right) => {
    const leftOrder = order[left.key] ?? 99;
    const rightOrder = order[right.key] ?? 99;
    return leftOrder - rightOrder;
  });
}

function resolveControlSubmenuLabel(control: LiveSessionControlDescriptor): string {
  if (control.key === "effort" || control.key === "reasoning") {
    return "Reasoning";
  }
  if (control.key === "fast_mode") {
    return "Speed";
  }
  return control.label;
}

function resolveHarnessSelection(
  group: ModelSelectorGroup,
): ModelSelectorSelection | null {
  const selectedModel = group.models.find((model) => model.isSelected) ?? group.models[0] ?? null;
  return selectedModel
    ? {
      kind: group.kind,
      modelId: selectedModel.modelId,
    }
    : null;
}

function resolveControlOptionLabel(
  agentKind: string | null,
  control: LiveSessionControlDescriptor,
  optionValue: string,
  optionLabel: string,
): string {
  if (control.key === "fast_mode") {
    if (optionValue === control.enabledValue) {
      return "Fast";
    }
    if (optionValue === control.disabledValue) {
      return "Standard";
    }
  }

  if (control.key === "effort") {
    return resolveReasoningEffortPresentation(optionValue, optionLabel).shortLabel ?? optionLabel;
  }

  if (control.key === "mode" || control.key === "collaboration_mode") {
    return resolveSessionControlPresentation(agentKind, control.key, optionValue).shortLabel ?? optionLabel;
  }

  return optionLabel;
}

function resolveControlOptionDescription(
  agentKind: string | null,
  control: LiveSessionControlDescriptor,
  optionValue: string,
  optionDescription?: string | null,
): string | null {
  if (control.key === "fast_mode") {
    if (optionValue === control.enabledValue) {
      return "1.5x speed, increased plan usage";
    }
    if (optionValue === control.disabledValue) {
      return "Default speed";
    }
  }

  if (control.key === "mode" || control.key === "collaboration_mode") {
    return resolveConfiguredSessionControlValue(agentKind, control.key, optionValue)?.description
      ?? shortenRuntimeDescription(optionDescription);
  }

  if (optionDescription) {
    return shortenRuntimeDescription(optionDescription);
  }

  return null;
}

function shortenRuntimeDescription(description?: string | null): string | null {
  const trimmed = description?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.length > 92 ? `${trimmed.slice(0, 89).trimEnd()}...` : trimmed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveTriggerLabel(modelSelectorProps: ModelSelectorProps): string {
  const {
    connectionState,
    currentModel,
    hasAgents,
    isLoading,
  } = modelSelectorProps;

  if (connectionState === "connecting") {
    return "Connecting...";
  }
  if (isLoading && !currentModel) {
    return "Loading agents...";
  }
  if (currentModel?.displayName) {
    return currentModel.displayName;
  }
  if (!hasAgents) {
    return "No agents";
  }
  return CHAT_MODEL_SELECTOR_LABELS.empty;
}

function filterModelGroups(
  groups: ModelSelectorGroup[],
  query: string,
): ModelSelectorGroup[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return groups;
  }

  return groups.flatMap((group) => {
    const providerMatches = group.providerDisplayName.toLowerCase().includes(normalizedQuery);
    const models = providerMatches
      ? group.models
      : group.models.filter((model) => model.displayName.toLowerCase().includes(normalizedQuery));
    return models.length > 0 ? [{ ...group, models }] : [];
  });
}
