import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { CHAT_MODEL_SELECTOR_LABELS } from "#product/copy/chat/chat-copy";
import { buildSettingsHref } from "#product/lib/domain/settings/navigation";
import { getSettingsSectionForHarnessKind } from "#product/lib/domain/settings/navigation-presentation";
import { splitProviderDisplayName } from "#product/lib/domain/chat/models/model-display-name-parts";
import { orderModelGroupsActiveFirst } from "#product/lib/domain/chat/models/order-model-groups";
import type {
  ModelSelectorGroup,
  ModelSelectorProps,
  ModelSelectorSelection,
} from "#product/lib/domain/chat/models/model-selector-types";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverSearchField } from "@proliferate/ui/primitives/PopoverSearchField";
import { ArrowUpRight, Check, Plus, Settings } from "@proliferate/ui/icons";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { ComposerPopoverSurface } from "@proliferate/product-ui/chat/composer/ComposerPopoverSurface";
import { PendingConfigIndicator } from "#product/components/workspace/chat/input/PendingConfigIndicator";

interface ComposerModelSelectorControlProps {
  modelSelectorProps: ModelSelectorProps;
}

export function ComposerModelSelectorControl({
  modelSelectorProps,
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
  // Stable qualification hook (attributes only): the id of the currently
  // selected model, derived from the group items already rendered. Lets the
  // local-world smoke driver assert the composer picker reflects its choice
  // without adding a modelId to the display-only `currentModel`. No behavior
  // change.
  const selectedModelId =
    groups.flatMap((group) => group.models).find((model) => model.isSelected)?.modelId ?? "";

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
        icon={currentModel ? <ProviderIcon kind={currentModel.kind} className="size-4 shrink-0" /> : undefined}
        label={triggerLabel}
        className="max-w-[15rem]"
      />
    );
  }

  return (
    <PopoverButton
      trigger={(
        <ComposerControlButton
          emphasizeLabel
          data-composer-model-trigger
          data-composer-selected-model={selectedModelId}
          icon={currentModel ? <ProviderIcon kind={currentModel.kind} className="size-4 shrink-0" /> : undefined}
          label={triggerLabel}
          trailing={currentModel?.pendingState
            ? <PendingConfigIndicator pendingState={currentModel.pendingState} />
            : null}
          aria-label={`Model: ${triggerLabel}`}
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
  onSelect,
  onAddProvider,
  onSettings,
}: {
  groups: ModelSelectorGroup[];
  currentModel: ModelSelectorProps["currentModel"];
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

  // Keyboard navigation: focus stays in the search field; ArrowUp/ArrowDown
  // move a roving highlight over the flattened model rows and Enter selects
  // it (mirrors the slash-command menu's single-focus-owner pattern). Rows are
  // keyed `${kind}:${modelId}` so the highlight survives refiltering.
  const flatModelKeys = useMemo(
    () => filteredGroups.flatMap((group) =>
      group.models.map((model) => modelRowKey(group.kind, model.modelId))
    ),
    [filteredGroups],
  );
  const selectionByKey = useMemo(() => {
    const byKey = new Map<string, ModelSelectorSelection>();
    for (const group of filteredGroups) {
      for (const model of group.models) {
        byKey.set(modelRowKey(group.kind, model.modelId), {
          kind: group.kind,
          modelId: model.modelId,
        });
      }
    }
    return byKey;
  }, [filteredGroups]);
  const initialHighlightKey = useMemo(() => {
    for (const group of filteredGroups) {
      const selected = group.models.find((model) => model.isSelected);
      if (selected) {
        return modelRowKey(group.kind, selected.modelId);
      }
    }
    return flatModelKeys[0] ?? null;
  }, [filteredGroups, flatModelKeys]);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(initialHighlightKey);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const effectiveHighlightedKey =
    highlightedKey && flatModelKeys.includes(highlightedKey)
      ? highlightedKey
      : initialHighlightKey;

  const setRowRef = useCallback((key: string, element: HTMLButtonElement | null) => {
    if (element) {
      rowRefs.current.set(key, element);
    } else {
      rowRefs.current.delete(key);
    }
  }, []);

  const moveHighlight = useCallback((delta: number) => {
    if (flatModelKeys.length === 0) {
      return;
    }
    const currentIndex = effectiveHighlightedKey
      ? flatModelKeys.indexOf(effectiveHighlightedKey)
      : -1;
    const nextIndex = Math.min(
      flatModelKeys.length - 1,
      Math.max(0, (currentIndex < 0 ? (delta > 0 ? -1 : 0) : currentIndex) + delta),
    );
    const nextKey = flatModelKeys[nextIndex];
    if (nextKey !== undefined) {
      setHighlightedKey(nextKey);
      rowRefs.current.get(nextKey)?.scrollIntoView({ block: "nearest" });
    }
  }, [effectiveHighlightedKey, flatModelKeys]);

  // Refiltering can leave the effective highlight on a row that just scrolled
  // out of the visible window; keep it in view.
  useEffect(() => {
    if (effectiveHighlightedKey) {
      rowRefs.current.get(effectiveHighlightedKey)?.scrollIntoView({ block: "nearest" });
    }
  }, [effectiveHighlightedKey]);

  const handleSearchKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const selection = effectiveHighlightedKey
        ? selectionByKey.get(effectiveHighlightedKey)
        : undefined;
      if (selection) {
        onSelect(selection);
      }
    }
  }, [effectiveHighlightedKey, moveHighlight, onSelect, selectionByKey]);

  return (
    <ComposerPopoverSurface className="flex w-72 flex-col p-0">
      <div className="shrink-0 border-b border-border">
        <PopoverSearchField
          value={search}
          onChange={setSearch}
          placeholder="Search models"
          autoFocus
          onKeyDown={handleSearchKeyDown}
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

function modelRowKey(kind: string, modelId: string): string {
  return `${kind}:${modelId}`;
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
  setRowRef: (key: string, element: HTMLButtonElement | null) => void;
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
        const rowKey = modelRowKey(group.kind, model.modelId);
        const isHighlighted = highlightedKey === rowKey;

        return (
          <PopoverMenuItem
            key={model.modelId}
            ref={(element: HTMLButtonElement | null) => setRowRef(rowKey, element)}
            data-model-option={model.modelId}
            data-model-selected={model.isSelected ? "true" : "false"}
            aria-selected={isHighlighted}
            onMouseEnter={() => onHighlight(rowKey)}
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
            className={`px-2.5 py-2 ${
              model.isSelected
                ? "bg-popover-accent"
                : isHighlighted
                  ? "bg-list-hover"
                  : ""
            }`}
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
