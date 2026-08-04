import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { APP_ROUTES } from "#product/config/app-routes";
import { CHAT_MODEL_SELECTOR_LABELS } from "#product/copy/chat/chat-copy";
import { buildSettingsHref } from "#product/lib/domain/settings/navigation";
import { getSettingsSectionForHarnessKind } from "#product/lib/domain/settings/navigation-presentation";
import { splitProviderDisplayName } from "#product/lib/domain/chat/models/model-display-name-parts";
import { orderModelGroupsActiveFirst } from "#product/lib/domain/chat/models/order-model-groups";
import { resolveReasoningEffortPresentation } from "#product/lib/domain/chat/session-controls/session-reasoning-effort-control";
import type {
  ModelSelectorGroup,
  ModelSelectorProps,
  ModelSelectorSelection,
} from "#product/lib/domain/chat/models/model-selector-types";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import { ComposerControlButton } from "@proliferate/ui/patterns/ComposerControlButton";
import { PopoverSearchField } from "@proliferate/ui/primitives/PopoverSearchField";
import { ArrowUpRight, Check, ChevronDown, Plus, Settings, Zap } from "@proliferate/ui/icons";
import { ProviderIcon } from "@proliferate/ui/icons/provider-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@proliferate/ui/primitives/DropdownMenu";
import { PendingConfigIndicator } from "#product/components/workspace/chat/input/PendingConfigIndicator";
import { ComposerFieldInlineError } from "#product/components/workspace/chat/input/ComposerFieldInlineError";
import { MODEL_UNSUPPORTED_ROW_HINT } from "#product/lib/domain/chat/models/model-support-refusals";
import { useModelSupportStore } from "#product/stores/chat/model-support-store";
import {
  modelRowKey,
  useModelPickerKeyboardNav,
} from "#product/hooks/chat/ui/use-model-picker-keyboard-nav";
import { useShortcutHandler } from "#product/hooks/shortcuts/lifecycle/use-shortcut-handler";
import { ComposerModelTuningControls } from "#product/components/workspace/chat/input/ComposerModelTuningControls";

interface ComposerModelSelectorControlProps {
  modelSelectorProps: ModelSelectorProps;
  reasoningControl?: LiveSessionControlDescriptor | null;
  fastModeControl?: LiveSessionControlDescriptor | null;
  disabled?: boolean;
  keyboardShortcutEnabled?: boolean;
}

export function ComposerModelSelectorControl({
  modelSelectorProps,
  reasoningControl = null,
  fastModeControl = null,
  disabled = false,
  keyboardShortcutEnabled = false,
}: ComposerModelSelectorControlProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    connectionState,
    currentModel,
    groups,
    hasAgents,
    isLoading,
    onSelect,
    unsupportedSelectionMessage = null,
  } = modelSelectorProps;
  const selectorEnabled = !disabled && connectionState === "healthy" && !isLoading && hasAgents;
  // The picker opens itself after a refusal so the marked rows are in front of
  // the user rather than one click away. Nonce-driven: two refusals in a row
  // each reopen it, and nothing has to reset a flag.
  const pickerRequestNonce = useModelSupportStore((state) => state.pickerRequestNonce);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    if (pickerRequestNonce === 0) {
      return;
    }
    setPickerOpen(true);
  }, [pickerRequestNonce]);
  useShortcutHandler("workspace.open-model-selector", () => {
    setPickerOpen((open) => !open);
  }, {
    enabled: keyboardShortcutEnabled
      && selectorEnabled
      && location.pathname === APP_ROUTES.home,
    priority: "contextual",
  });
  const triggerLabel = resolveTriggerLabel(modelSelectorProps);
  const selectedReasoningOption = reasoningControl?.options.find((option) => option.selected) ?? null;
  const reasoningLabel = resolveReasoningEffortPresentation(
    selectedReasoningOption?.value ?? null,
    selectedReasoningOption?.label ?? reasoningControl?.detail,
  ).shortLabel;
  const fastModeLabel = fastModeControl
    ? (fastModeControl.isEnabled ? "Fast" : "Default")
    : null;
  // Stable qualification hook (attributes only): prefer the model whose
  // rendered identity matches the current chip. During live-config restore,
  // the requested launch row can remain selected while `currentModel` already
  // reflects the effective model reported by the running session. The hook
  // must describe the same effective model the user sees, then fall back to
  // the ordinary selected row when the live label has no unique catalog match.
  const modelsForCurrentKind = currentModel
    ? groups
      .filter((group) => group.kind === currentModel.kind)
      .flatMap((group) => group.models)
    : [];
  const effectiveModelMatches = currentModel
    ? modelsForCurrentKind.filter((model) => model.displayName === currentModel.displayName)
    : [];
  const selectedModelId = effectiveModelMatches.length === 1
    ? effectiveModelMatches[0].modelId
    : modelsForCurrentKind.find((model) => model.isSelected)?.modelId
      ?? groups.flatMap((group) => group.models).find((model) => model.isSelected)?.modelId
      ?? "";

  // UX_SPEC S5: adding a harness routes to Settings -> per-harness agent pages.
  const handleAddProvider = useCallback(() => {
    navigate(buildSettingsHref({ section: "agent-claude" }));
  }, [navigate]);

  const handleSettings = useCallback(() => {
    const section = currentModel
      ? getSettingsSectionForHarnessKind(currentModel.kind)
      : null;
    navigate(buildSettingsHref({ section: section ?? "agent-claude" }));
  }, [navigate, currentModel]);

  if (!selectorEnabled) {
    return (
      <ComposerControlButton
        disabled
        data-composer-model-trigger
        data-composer-selected-model={selectedModelId}
        icon={currentModel ? <ProviderIcon kind={currentModel.kind} className="icon-control shrink-0 [font-size:var(--text-composer)]" /> : undefined}
        label={triggerLabel}
        detail={reasoningLabel}
        className="max-w-[15rem]"
      />
    );
  }

  return (
    <span className="flex min-w-0 flex-col items-start gap-1">
      <DropdownMenu open={pickerOpen} onOpenChange={setPickerOpen}>
        <DropdownMenuTrigger asChild>
          <ComposerControlButton
            emphasizeLabel
            data-composer-model-trigger
            data-composer-selected-model={selectedModelId}
            icon={currentModel ? <ProviderIcon kind={currentModel.kind} className="icon-control shrink-0 [font-size:var(--text-composer)]" /> : undefined}
            label={triggerLabel}
            detail={reasoningLabel}
            trailing={(
              <span className="flex items-center gap-1">
                {fastModeControl?.isEnabled && (
                  <Zap aria-hidden="true" className="icon-paired fill-current text-muted-foreground" />
                )}
                <PendingConfigIndicator pendingState={currentModel?.pendingState ?? null} />
                <PendingConfigIndicator pendingState={reasoningControl?.pendingState ?? null} />
                <PendingConfigIndicator pendingState={fastModeControl?.pendingState ?? null} />
                <ChevronDown aria-hidden="true" className="icon-paired text-muted-foreground" />
              </span>
            )}
            aria-label={`${reasoningLabel
              ? `Model and reasoning: ${triggerLabel}, ${reasoningLabel}`
              : `Model: ${triggerLabel}`}${fastModeControl ? `, Fast mode: ${fastModeLabel}` : ""}`}
            aria-invalid={unsupportedSelectionMessage ? true : undefined}
            aria-describedby={unsupportedSelectionMessage
              ? MODEL_UNSUPPORTED_MESSAGE_ID
              : undefined}
            className="max-w-[15rem]"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={2}
          className="w-56 min-w-56"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <ComposerModelPickerMenu
            groups={groups}
            currentModel={currentModel}
            currentModelLabel={triggerLabel}
            reasoningControl={reasoningControl}
            fastModeControl={fastModeControl}
            onSelect={(selection) => {
              onSelect(selection);
              setPickerOpen(false);
            }}
            onAddProvider={() => {
              handleAddProvider();
              setPickerOpen(false);
            }}
            onSettings={() => {
              handleSettings();
              setPickerOpen(false);
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Field-scoped, so it lives with the field: the model the composer is on
          is one this target refuses, and the control above is what fixes it. */}
      {unsupportedSelectionMessage && (
        <ComposerFieldInlineError id={MODEL_UNSUPPORTED_MESSAGE_ID}>
          {unsupportedSelectionMessage}
        </ComposerFieldInlineError>
      )}
    </span>
  );
}

const MODEL_UNSUPPORTED_MESSAGE_ID = "composer-model-unsupported";

function ComposerModelPickerMenu({
  groups,
  currentModel,
  currentModelLabel,
  reasoningControl,
  fastModeControl,
  onSelect,
  onAddProvider,
  onSettings,
}: {
  groups: ModelSelectorGroup[];
  currentModel: ModelSelectorProps["currentModel"];
  currentModelLabel: string;
  reasoningControl: LiveSessionControlDescriptor | null;
  fastModeControl: LiveSessionControlDescriptor | null;
  onSelect: (selection: ModelSelectorSelection) => void;
  onAddProvider: () => void;
  onSettings: () => void;
}) {
  return (
    <>
      <ModelOptionsSubmenu
        groups={groups}
        currentModel={currentModel}
        currentModelLabel={currentModelLabel}
        onSelect={onSelect}
      />
      <ComposerModelTuningControls
        reasoningControl={reasoningControl}
        fastModeControl={fastModeControl}
      />
      <DropdownMenuSeparator />
      <AdvancedOptionsSubmenu
        onAddProvider={onAddProvider}
        onSettings={onSettings}
      />
    </>
  );
}

function ModelOptionsSubmenu({
  groups,
  currentModel,
  currentModelLabel,
  onSelect,
}: {
  groups: ModelSelectorGroup[];
  currentModel: ModelSelectorProps["currentModel"];
  currentModelLabel: string;
  onSelect: (selection: ModelSelectorSelection) => void;
}) {
  const currentKind = currentModel?.kind ?? null;
  const orderedGroups = orderModelGroupsActiveFirst(groups, currentKind);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return orderedGroups;
    }

    return orderedGroups
      .map((group) => {
        const groupMatches = group.providerDisplayName.toLowerCase().includes(query)
          || group.kind.toLowerCase().includes(query);
        if (groupMatches) {
          return group;
        }

        const models = group.models.filter((model) => model.displayName.toLowerCase().includes(query));
        return models.length > 0 ? { ...group, models } : null;
      })
      .filter((group): group is ModelSelectorGroup => group !== null);
  }, [orderedGroups, search]);

  const {
    highlightedKey: effectiveHighlightedKey,
    setHighlightedKey,
    setRowRef,
    handleSearchKeyDown,
  } = useModelPickerKeyboardNav(filteredGroups, onSelect);

  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger
        data-composer-model-menu
        className="py-2 text-composer"
        onClick={() => setOpen(true)}
      >
        <span className="min-w-0 flex-1">Model</span>
        <span className="max-w-28 truncate text-muted-foreground">{currentModelLabel}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        sideOffset={4}
        alignOffset={-4}
        className="flex max-h-96 w-72 flex-col overflow-hidden p-0"
      >
        <div className="shrink-0 border-b border-border">
          <PopoverSearchField
            value={search}
            onChange={setSearch}
            placeholder="Search models"
            autoFocus
            onKeyDown={(event) => {
              event.stopPropagation();
              handleSearchKeyDown(event);
            }}
          />
        </div>

        <div className="min-h-0 overflow-y-auto [scrollbar-gutter:stable] p-1">
          {filteredGroups.map((group, index) => (
            <ModelPickerGroup
              key={group.kind}
              group={group}
              currentKind={currentKind}
              showSeparator={index > 0}
              onSelect={onSelect}
              highlightedKey={effectiveHighlightedKey}
              onHighlight={setHighlightedKey}
              setRowRef={setRowRef}
            />
          ))}

          {orderedGroups.length === 0 && (
            <p className="px-3 py-4 text-center text-ui text-muted-foreground">
              {CHAT_MODEL_SELECTOR_LABELS.noProviders}
            </p>
          )}

          {orderedGroups.length > 0 && filteredGroups.length === 0 && (
            <p className="px-3 py-4 text-center text-ui text-muted-foreground">
              No models match "{search}"
            </p>
          )}
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function AdvancedOptionsSubmenu({
  onAddProvider,
  onSettings,
}: {
  onAddProvider: () => void;
  onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger
        className="text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        Advanced
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent sideOffset={4} alignOffset={-4} className="w-56">
        <DropdownMenuItem onSelect={onAddProvider}>
          <Plus className="icon-compact shrink-0" />
          <span>Add provider</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSettings}>
          <Settings className="icon-compact shrink-0" />
          <span>Settings</span>
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ModelPickerGroup({
  group,
  currentKind,
  showSeparator,
  onSelect,
  highlightedKey,
  onHighlight,
  setRowRef,
}: {
  group: ModelSelectorGroup;
  currentKind: string | null;
  showSeparator: boolean;
  onSelect: (selection: ModelSelectorSelection) => void;
  highlightedKey: string | null;
  onHighlight: (key: string) => void;
  setRowRef: (key: string, element: HTMLElement | null) => void;
}) {
  const hasSelectedModel = group.models.some((model) => model.isSelected);

  return (
    <>
      {/* Group anatomy: hairline between groups, then a muted harness header
          (icon + name) above the group's model rows. */}
      {showSeparator && (
        <div className="mt-1 w-full px-2 py-0.5">
          <div className="h-px w-full bg-border/60" />
        </div>
      )}
      <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-1.5 text-ui-sm text-muted-foreground">
        <ProviderIcon kind={group.kind} className="icon-compact shrink-0 [font-size:var(--text-composer)]" />
        <span className="truncate">{group.providerDisplayName}</span>
      </div>

      {group.models.map((model) => {
        const showNewChatIndicator =
          model.actionKind === "open_new_chat"
          && !model.isSelected
          && !hasSelectedModel
          && group.kind !== currentKind;

        const nameParts = splitProviderDisplayName(model.displayName);
        const rowKey = modelRowKey(group.kind, model.modelId);
        const isHighlighted = highlightedKey === rowKey;

        return (
          <DropdownMenuItem
            key={model.modelId}
            ref={(element) => setRowRef(rowKey, element)}
            data-model-option={model.modelId}
            data-model-kind={group.kind}
            data-model-selected={model.isSelected ? "true" : "false"}
            data-model-unsupported={model.isUnsupported ? "true" : "false"}
            // Disabled, not hidden: the row is the answer to "where did my model
            // go", and the hint below it is what turns a dead row into an
            // explanation. The primitive already carries the disabled styling.
            disabled={model.isUnsupported}
            aria-selected={isHighlighted}
            onMouseEnter={() => onHighlight(rowKey)}
            className={`items-start px-2.5 py-2 text-composer ${
              !model.isUnsupported && (model.isSelected || isHighlighted) ? "bg-hover" : ""
            }`}
            onSelect={() => onSelect({ kind: group.kind, modelId: model.modelId })}
          >
            <ProviderIcon kind={group.kind} className="icon-compact mt-0.5 shrink-0 text-muted-foreground [font-size:var(--text-composer)]" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 truncate">{nameParts.leaf}</span>
                {nameParts.badge && (
                  <span className="shrink-0 text-ui-sm text-muted-foreground">{nameParts.badge}</span>
                )}
              </span>
              {model.isUnsupported && (
                <span className="mt-0.5 text-ui-sm text-muted-foreground">
                  {MODEL_UNSUPPORTED_ROW_HINT}
                </span>
              )}
            </span>
            <span className="flex size-3.5 shrink-0 items-center justify-center">
              {showNewChatIndicator ? (
                <ArrowUpRight className="icon-paired shrink-0 text-muted-foreground/60" />
              ) : model.isSelected ? (
                <Check className="icon-paired shrink-0 text-foreground/60" />
              ) : null}
            </span>
          </DropdownMenuItem>
        );
      })}
    </>
  );
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
    // Show only the leaf name on the pill — the provider icon already carries harness identity.
    return splitProviderDisplayName(currentModel.displayName).leaf;
  }
  if (!hasAgents) {
    return "No agents";
  }
  return CHAT_MODEL_SELECTOR_LABELS.empty;
}
