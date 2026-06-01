import { CHAT_MODEL_SELECTOR_LABELS } from "@/copy/chat/chat-copy";
import type {
  ModelSelectorGroup,
  ModelSelectorSelection,
} from "@/lib/domain/chat/models/model-selector-types";
import { Input } from "@proliferate/ui/primitives/Input";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { Check } from "@proliferate/ui/icons";

export function ComposerModelPickerContent({
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

export function ComposerMenuSeparator() {
  return (
    <div className="w-full px-2 py-0.5">
      <div className="h-px w-full bg-border/60" />
    </div>
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
