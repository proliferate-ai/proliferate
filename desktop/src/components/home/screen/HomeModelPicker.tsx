import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { PickerPopoverContent } from "@/components/ui/PickerPopoverContent";
import { PillControlButton } from "@/components/ui/PillControlButton";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { Check, ProviderIcon, Sparkles } from "@/components/ui/icons";
import type {
  HomeNextModelGroup,
  HomeNextModelInfo,
  HomeNextModelSelection,
} from "@/lib/domain/home/home-next-launch";

interface HomeModelPickerProps {
  groups: HomeNextModelGroup[];
  selectedModel: HomeNextModelInfo | null;
  onSelect: (selection: HomeNextModelSelection) => void;
}

export function HomeModelPicker({
  groups,
  selectedModel,
  onSelect,
}: HomeModelPickerProps) {
  const label = selectedModel
    ? `${selectedModel.providerDisplayName} · ${selectedModel.model.displayName}`
    : "No models";

  return (
    <PopoverButton
      trigger={(
        <PillControlButton
          icon={selectedModel ? <ProviderIcon kind={selectedModel.kind} className="size-4" /> : <Sparkles className="size-3.5" />}
          label={label}
          disabled={groups.length === 0}
          disclosure
          className="max-w-[12rem]"
        />
      )}
      side="top"
      className="w-72 rounded-xl border border-border bg-popover p-1 shadow-floating"
    >
      {(close) => (
        <PickerPopoverContent>
          {groups.map((group, index) => (
            <div key={group.kind}>
              {index > 0 ? <div className="my-1 h-px bg-border" /> : null}
              <div className="px-2.5 pb-1 pt-1.5 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground/60">
                {group.providerDisplayName}
              </div>
              {group.models.map((model) => (
                <PopoverMenuItem
                  key={`${group.kind}:${model.modelId}`}
                  icon={<ProviderIcon kind={group.kind} className="size-4" />}
                  label={model.displayName}
                  trailing={model.isSelected ? <Check className="size-3.5" /> : null}
                  onClick={() => {
                    onSelect({ kind: group.kind, modelId: model.modelId });
                    close();
                  }}
                />
              ))}
            </div>
          ))}
        </PickerPopoverContent>
      )}
    </PopoverButton>
  );
}
