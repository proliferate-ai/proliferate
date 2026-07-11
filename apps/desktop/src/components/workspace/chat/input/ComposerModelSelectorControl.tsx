import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CHAT_MODEL_SELECTOR_LABELS } from "@/copy/chat/chat-copy";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";
import { getSettingsSectionForHarnessKind } from "@/lib/domain/settings/navigation-presentation";
import { splitProviderDisplayName } from "@/lib/domain/chat/models/model-display-name-parts";
import { orderModelGroupsActiveFirst } from "@/lib/domain/chat/models/order-model-groups";
import type {
  ModelSelectorGroup,
  ModelSelectorProps,
  ModelSelectorSelection,
} from "@/lib/domain/chat/models/model-selector-types";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";
import { resolveReasoningEffortPresentation } from "@/lib/domain/chat/session-controls/session-reasoning-effort-control";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverSearchField } from "@proliferate/ui/primitives/PopoverSearchField";
import { ArrowUpRight, Check, ChevronDown, Plus, Settings, Zap } from "@proliferate/ui/icons";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { ComposerPopoverSurface } from "@proliferate/product-ui/chat/composer/ComposerPopoverSurface";
import { PendingConfigIndicator } from "./PendingConfigIndicator";

interface ComposerModelSelectorControlProps {
  modelSelectorProps: ModelSelectorProps;
  reasoningControl?: LiveSessionControlDescriptor | null;
  fastModeControl?: LiveSessionControlDescriptor | null;
}

export function ComposerModelSelectorControl({
  modelSelectorProps,
  reasoningControl = null,
  fastModeControl = null,
}: ComposerModelSelectorControlProps) {
  const navigate = useNavigate();
  const {
    connectionState,
    currentModel,
    groups,
    hasAgents,
    isLoading,
    onSelect,
  } = modelSelectorProps;
  const selectorEnabled = connectionState === "healthy" && !isLoading && hasAgents;
  const triggerLabel = resolveTriggerLabel(modelSelectorProps);
  const selectedReasoningOption = reasoningControl?.options.find((option) => option.selected) ?? null;
  const reasoningLabel = resolveReasoningEffortPresentation(
    selectedReasoningOption?.value ?? null,
    selectedReasoningOption?.label ?? reasoningControl?.detail,
  ).shortLabel;
  const triggerTrailing = (
    <span className="flex items-center gap-1">
      {fastModeControl?.isEnabled && (
        <Zap aria-hidden="true" className="size-3 fill-current text-muted-foreground" />
      )}
      <PendingConfigIndicator pendingState={currentModel?.pendingState ?? null} />
      <PendingConfigIndicator pendingState={reasoningControl?.pendingState ?? null} />
      <PendingConfigIndicator pendingState={fastModeControl?.pendingState ?? null} />
      <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
    </span>
  );

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
        icon={currentModel ? <ProviderIcon kind={currentModel.kind} className="size-4 shrink-0" /> : undefined}
        label={triggerLabel}
        detail={reasoningLabel}
        className="max-w-[15rem]"
      />
    );
  }

  return (
    <PopoverButton
      trigger={(
        <ComposerControlButton
          emphasizeLabel
          icon={currentModel ? <ProviderIcon kind={currentModel.kind} className="size-4 shrink-0" /> : undefined}
          label={triggerLabel}
          detail={reasoningLabel}
          trailing={triggerTrailing}
          aria-label={`${reasoningLabel
            ? `Model and reasoning: ${triggerLabel}, ${reasoningLabel}`
            : `Model: ${triggerLabel}`}${fastModeControl?.isEnabled ? ", Fast mode on" : ""}`}
          className="max-w-[15rem]"
        />
      )}
      side="top"
      align="start"
      offset={2}
      className="w-auto border-0 bg-transparent p-0 shadow-none"
    >
      {(close) => (
        <ComposerModelPickerPopover
          groups={groups}
          currentModel={currentModel}
          reasoningControl={reasoningControl}
          fastModeControl={fastModeControl}
          onSelect={(selection) => {
            onSelect(selection);
            close();
          }}
          onAddProvider={() => {
            handleAddProvider();
            close();
          }}
          onSettings={() => {
            handleSettings();
            close();
          }}
        />
      )}
    </PopoverButton>
  );
}

function ComposerModelPickerPopover({
  groups,
  currentModel,
  reasoningControl,
  fastModeControl,
  onSelect,
  onAddProvider,
  onSettings,
}: {
  groups: ModelSelectorGroup[];
  currentModel: ModelSelectorProps["currentModel"];
  reasoningControl: LiveSessionControlDescriptor | null;
  fastModeControl: LiveSessionControlDescriptor | null;
  onSelect: (selection: ModelSelectorSelection) => void;
  onAddProvider: () => void;
  onSettings: () => void;
}) {
  const currentKind = currentModel?.kind ?? null;
  const orderedGroups = orderModelGroupsActiveFirst(groups, currentKind);
  const [search, setSearch] = useState("");

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

  return (
    <ComposerPopoverSurface className="flex w-72 flex-col p-0">
      <div className="shrink-0 border-b border-border">
        <PopoverSearchField
          value={search}
          onChange={setSearch}
          placeholder="Search models"
          autoFocus
        />
      </div>

      <div className="max-h-80 min-h-0 overflow-y-auto [scrollbar-gutter:stable] p-1">
        {filteredGroups.map((group, index) => (
          <ModelPickerGroup
            key={group.kind}
            group={group}
            currentKind={currentKind}
            showSeparator={index > 0}
            onSelect={onSelect}
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

        {!search.trim() && (reasoningControl || fastModeControl) && (
          <ModelTuningControls
            reasoningControl={reasoningControl}
            fastModeControl={fastModeControl}
          />
        )}
      </div>

      <div className="shrink-0 border-t border-border p-1">
        <PopoverMenuItem
          icon={<Plus className="size-3 shrink-0" />}
          label="Add provider"
          density="compact"
          className="text-ui-sm text-muted-foreground hover:text-popover-foreground"
          onClick={onAddProvider}
        />
        <PopoverMenuItem
          icon={<Settings className="size-3 shrink-0" />}
          label="Settings"
          density="compact"
          className="text-ui-sm text-muted-foreground hover:text-popover-foreground"
          onClick={onSettings}
        />
      </div>
    </ComposerPopoverSurface>
  );
}

function ModelTuningControls({
  reasoningControl,
  fastModeControl,
}: {
  reasoningControl: LiveSessionControlDescriptor | null;
  fastModeControl: LiveSessionControlDescriptor | null;
}) {
  const nextFastModeValue = fastModeControl?.isEnabled
    ? fastModeControl.disabledValue
    : fastModeControl?.enabledValue;

  return (
    <div className="mt-1 border-t border-border pt-1">
      {reasoningControl && (
        <>
          <div className="px-2.5 pb-1 pt-1.5 text-ui-sm text-muted-foreground">
            Reasoning effort
          </div>
          {reasoningControl.options.map((option) => (
            <PopoverMenuItem
              key={option.value}
              label={resolveReasoningEffortPresentation(
                option.value,
                option.label,
              ).shortLabel ?? option.label}
              trailing={(
                <span className="flex items-center gap-1">
                  {option.selected && <Check className="size-3.5 text-foreground/60" />}
                  {option.selected && (
                    <PendingConfigIndicator pendingState={reasoningControl.pendingState} />
                  )}
                </span>
              )}
              disabled={!reasoningControl.settable}
              labelClassName="text-composer"
              className={`px-2.5 py-2 ${option.selected ? "bg-popover-accent" : ""}`}
              onClick={() => reasoningControl.onSelect(option.value)}
            />
          ))}
        </>
      )}

      {fastModeControl && (
        <PopoverMenuItem
          icon={(
            <Zap className={`size-3.5 ${fastModeControl.isEnabled ? "fill-current" : ""}`} />
          )}
          label="Fast mode"
          trailing={(
            <span className="flex items-center gap-1 text-muted-foreground">
              <span>{fastModeControl.isEnabled ? "On" : "Off"}</span>
              <PendingConfigIndicator pendingState={fastModeControl.pendingState} />
            </span>
          )}
          disabled={!fastModeControl.settable || !nextFastModeValue}
          labelClassName="text-composer"
          className="px-2.5 py-2"
          onClick={() => {
            if (nextFastModeValue) {
              fastModeControl.onSelect(nextFastModeValue);
            }
          }}
        />
      )}
    </div>
  );
}

function ModelPickerGroup({
  group,
  currentKind,
  showSeparator,
  onSelect,
}: {
  group: ModelSelectorGroup;
  currentKind: string | null;
  showSeparator: boolean;
  onSelect: (selection: ModelSelectorSelection) => void;
}) {
  const hasSelectedModel = group.models.some((model) => model.isSelected);

  return (
    <>
      {/* Conductor-style group anatomy (reference/conductor/input/models.html):
          hairline between groups, then a muted harness header (icon + name)
          above the group's model rows. */}
      {showSeparator && (
        <div className="mt-1 w-full px-2 py-0.5">
          <div className="h-px w-full bg-border/60" />
        </div>
      )}
      <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-1.5 text-ui-sm text-muted-foreground">
        <ProviderIcon kind={group.kind} className="size-3 shrink-0" />
        <span className="truncate">{group.providerDisplayName}</span>
      </div>

      {group.models.map((model) => {
        const showNewChatIndicator =
          model.actionKind === "open_new_chat"
          && !model.isSelected
          && !hasSelectedModel
          && group.kind !== currentKind;

        const nameParts = splitProviderDisplayName(model.displayName);

        return (
          <PopoverMenuItem
            key={model.modelId}
            icon={<ProviderIcon kind={group.kind} className="size-3 shrink-0 text-muted-foreground" />}
            label={(
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 truncate">{nameParts.leaf}</span>
                {nameParts.badge && (
                  <span className="shrink-0 text-ui-sm text-muted-foreground">{nameParts.badge}</span>
                )}
              </span>
            )}
            trailing={(
              <span className="flex size-3.5 shrink-0 items-center justify-center">
                {showNewChatIndicator ? (
                  <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                ) : model.isSelected ? (
                  <Check className="size-3.5 shrink-0 text-foreground/60" />
                ) : null}
              </span>
            )}
            labelClassName="text-composer"
            className={`px-2.5 py-2 ${model.isSelected ? "bg-popover-accent" : ""}`}
            onClick={() => onSelect({ kind: group.kind, modelId: model.modelId })}
          />
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
