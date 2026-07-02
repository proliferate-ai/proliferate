import { CHAT_MODEL_SELECTOR_LABELS } from "@/copy/chat/chat-copy";
import type {
  ModelSelectorGroup,
  ModelSelectorSelection,
} from "@/lib/domain/chat/models/model-selector-types";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { PopoverSearchField } from "@proliferate/ui/primitives/PopoverSearchField";
import { Check } from "@proliferate/ui/icons";

export function ComposerModelPickerContent({
  activeKind,
  filteredGroups,
  groups,
  search,
  onSearchChange,
  onSelect,
}: {
  activeKind: string | null;
  filteredGroups: ModelSelectorGroup[];
  groups: ModelSelectorGroup[];
  search: string;
  onSearchChange: (search: string) => void;
  onSelect: (selection: ModelSelectorSelection) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-1">
      {/* Inline search (codex menu recipe) — same shared field as every other
          picker popover; the Superset inset treatment stays on approvals only. */}
      <PopoverSearchField
        value={search}
        onChange={onSearchChange}
        placeholder={CHAT_MODEL_SELECTOR_LABELS.searchPlaceholder}
        autoFocus
      />

      <div className="min-h-0 max-h-[11rem] overflow-y-auto">
        {filteredGroups.map((group, index) => (
          <ComposerModelGroup
            key={group.kind}
            activeKind={activeKind}
            group={group}
            showSeparator={index > 0}
            onSelect={onSelect}
          />
        ))}

        {filteredGroups.length === 0 && groups.length > 0 && (
          <p className="px-3 py-4 text-center text-ui text-muted-foreground">
            {CHAT_MODEL_SELECTOR_LABELS.noMatchPrefix} "{search}"
          </p>
        )}

        {groups.length === 0 && (
          <p className="px-3 py-4 text-center text-ui text-muted-foreground">
            {CHAT_MODEL_SELECTOR_LABELS.noProviders}
          </p>
        )}
      </div>
    </div>
  );
}

export function ComposerMenuSeparator() {
  return (
    <div className="w-full px-2 py-0.5">
      <div className="h-px w-full bg-border/60" />
    </div>
  );
}

function ComposerModelGroup({
  activeKind,
  group,
  showSeparator,
  onSelect,
}: {
  activeKind: string | null;
  group: ModelSelectorGroup;
  showSeparator: boolean;
  onSelect: (selection: ModelSelectorSelection) => void;
}) {
  const hasSelectedModel = group.models.some((model) => model.isSelected);

  return (
    <>
      {showSeparator && <div className="mx-2 my-1 border-t border-border/60" />}
      <div className="min-h-5 truncate px-2.5 py-0.5 text-ui-sm font-[430] text-muted-foreground/70">
        {group.providerDisplayName}
      </div>
      {group.models.map((model) => (
        <PopoverMenuItem
          key={model.modelId}
          label={model.displayName}
          trailing={
            <span className="flex items-center gap-1">
              {model.actionKind === "open_new_chat"
                && !model.isSelected
                && !hasSelectedModel
                && group.kind !== activeKind && (
                <span className="text-ui-sm text-muted-foreground/70">
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
