import { useMemo, useState } from "react";
import { CHAT_MODEL_SELECTOR_LABELS } from "#product/copy/chat/chat-copy";
import { splitProviderDisplayName } from "#product/lib/domain/chat/models/model-display-name-parts";
import { orderModelGroupsActiveFirst } from "#product/lib/domain/chat/models/order-model-groups";
import type {
  ModelSelectorGroup,
  ModelSelectorProps,
  ModelSelectorSelection,
} from "#product/lib/domain/chat/models/model-selector-types";
import { MODEL_UNSUPPORTED_ROW_HINT } from "#product/lib/domain/chat/models/model-support-refusals";
import {
  modelRowKey,
  useModelPickerKeyboardNav,
} from "#product/hooks/chat/ui/use-model-picker-keyboard-nav";
import { ArrowUpRight, Check } from "#product/primitives/icons/core";
import { ProviderIcon } from "#product/primitives/icons/provider-icons";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "#product/primitives/DropdownMenu";
import { PopoverSearchField } from "#product/primitives/PopoverSearchField";

export function ComposerModelOptionsSubmenu({
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
