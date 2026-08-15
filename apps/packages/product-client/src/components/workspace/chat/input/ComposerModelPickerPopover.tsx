import { useCallback, useMemo, useState } from "react";
import { CHAT_MODEL_SELECTOR_LABELS } from "#product/copy/chat/chat-copy";
import { useModelPickerKeyboardNav, modelRowKey } from "#product/hooks/chat/ui/use-model-picker-keyboard-nav";
import { splitProviderDisplayName } from "#product/lib/domain/chat/models/model-display-name-parts";
import { orderModelGroupsActiveFirst } from "#product/lib/domain/chat/models/order-model-groups";
import { MODEL_UNSUPPORTED_ROW_HINT } from "#product/lib/domain/chat/models/model-support-refusals";
import type {
  ModelSelectorGroup,
  ModelSelectorProps,
  ModelSelectorSelection,
} from "#product/lib/domain/chat/models/model-selector-types";
import { ComposerPopoverSurface } from "#product/components/workspace/chat/composer/ComposerPopoverSurface";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";
import { PopoverSearchField } from "#product/primitives/PopoverSearchField";
import { ArrowUpRight, Check, Plus, Settings } from "#product/primitives/icons/core";
import { ProviderIcon } from "#product/primitives/icons/provider-icons";

interface ComposerModelPickerPopoverProps {
  groups: ModelSelectorGroup[];
  currentModel: ModelSelectorProps["currentModel"];
  onKeyboardClose: () => void;
  onSelect: (selection: ModelSelectorSelection) => void;
  onAddProvider: () => void;
  onSettings: () => void;
}

export function ComposerModelPickerPopover({
  groups,
  currentModel,
  onKeyboardClose,
  onSelect,
  onAddProvider,
  onSettings,
}: ComposerModelPickerPopoverProps) {
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

  const handleKeyboardSelect = useCallback((selection: ModelSelectorSelection) => {
    onKeyboardClose();
    onSelect(selection);
  }, [onKeyboardClose, onSelect]);

  const {
    highlightedKey,
    setHighlightedKey,
    setRowRef,
    handleSearchKeyDown,
  } = useModelPickerKeyboardNav(filteredGroups, handleKeyboardSelect);

  return (
    <ComposerPopoverSurface
      className="flex w-72 flex-col p-0"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onKeyboardClose();
        }
      }}
    >
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
            onKeyboardSelect={onKeyboardClose}
            highlightedKey={highlightedKey}
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
          icon={<Plus className="icon-compact shrink-0" />}
          label="Add provider"
          density="compact"
          className="text-ui-sm text-muted-foreground hover:text-popover-foreground"
          onClick={onAddProvider}
        />
        <PopoverMenuItem
          icon={<Settings className="icon-compact shrink-0" />}
          label="Settings"
          density="compact"
          className="text-ui-sm text-muted-foreground hover:text-popover-foreground"
          onClick={onSettings}
        />
      </div>
    </ComposerPopoverSurface>
  );
}

interface ModelPickerGroupProps {
  group: ModelSelectorGroup;
  currentKind: string | null;
  showSeparator: boolean;
  onSelect: (selection: ModelSelectorSelection) => void;
  onKeyboardSelect: () => void;
  highlightedKey: string | null;
  onHighlight: (key: string) => void;
  setRowRef: (key: string, element: HTMLButtonElement | null) => void;
}

function ModelPickerGroup({
  group,
  currentKind,
  showSeparator,
  onSelect,
  onKeyboardSelect,
  highlightedKey,
  onHighlight,
  setRowRef,
}: ModelPickerGroupProps) {
  const hasSelectedModel = group.models.some((model) => model.isSelected);

  return (
    <>
      {showSeparator && (
        <div className="mt-1 w-full px-2 py-0.5">
          <div className="h-px w-full bg-border/60" />
        </div>
      )}
      <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-1.5 text-ui-sm text-muted-foreground">
        <ProviderIcon kind={group.kind} className="icon-compact shrink-0 [font-size:var(--text-body)]" />
        <span className="truncate">{group.providerDisplayName}</span>
      </div>

      {group.models.map((model) => {
        const showNewChatIndicator = model.actionKind === "open_new_chat"
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
            data-model-kind={group.kind}
            data-model-selected={model.isSelected ? "true" : "false"}
            data-model-unsupported={model.isUnsupported ? "true" : "false"}
            disabled={model.isUnsupported}
            aria-selected={isHighlighted}
            onMouseEnter={() => onHighlight(rowKey)}
            icon={<ProviderIcon kind={group.kind} className="icon-compact shrink-0 text-muted-foreground [font-size:var(--text-body)]" />}
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
                  <ArrowUpRight className="icon-paired shrink-0 text-muted-foreground/60" />
                ) : model.isSelected ? (
                  <Check className="icon-paired shrink-0 text-foreground/60" />
                ) : null}
              </span>
            )}
            labelClassName="text-body"
            className={`px-2.5 py-2 ${
              !model.isUnsupported && (model.isSelected || isHighlighted) ? "bg-hover" : ""
            }`}
            onKeyDown={(event) => {
              if (
                event.target === event.currentTarget
                && (event.key === "Enter" || event.key === " ")
              ) {
                onKeyboardSelect();
              }
            }}
            onClick={() => onSelect({ kind: group.kind, modelId: model.modelId })}
          >
            {model.isUnsupported ? MODEL_UNSUPPORTED_ROW_HINT : null}
          </PopoverMenuItem>
        );
      })}
    </>
  );
}
