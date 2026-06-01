import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { Check, ChevronDown } from "@proliferate/ui/icons";
import { ProviderIcon } from "@proliferate/ui/provider-icons";

export interface AgentHarnessModelOption {
  id: string;
  label: string;
  detail?: string | null;
}

export interface AgentHarnessModelGroup {
  agentKind: string;
  agentDisplayName: string;
  models: AgentHarnessModelOption[];
}

interface AgentHarnessModelSelectorProps {
  label: string;
  agentKind: string | null;
  selectedModelId: string | null;
  modelGroups: AgentHarnessModelGroup[];
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  onSelectModel: (agentKind: string, modelId: string) => void;
}

export function AgentHarnessModelSelector({
  label,
  agentKind,
  selectedModelId,
  modelGroups,
  disabled = false,
  className = "max-w-[14rem]",
  menuClassName = "w-72",
  onSelectModel,
}: AgentHarnessModelSelectorProps) {
  const groups = modelGroups.filter((group) => group.models.length > 0);
  const icon = agentKind
    ? <ProviderIcon kind={agentKind} className="size-3.5" />
    : null;

  return (
    <PopoverButton
      trigger={
        <ComposerControlButton
          disabled={disabled || groups.length === 0}
          icon={icon}
          label={label}
          trailing={<ChevronDown className="size-3 shrink-0 text-[color:var(--color-composer-control-muted-foreground)]" />}
          aria-label="Agent model"
          className={className}
        />
      }
      side="top"
      className={`${menuClassName} ${POPOVER_SURFACE_CLASS}`}
    >
      {(close) => (
        <div className="max-h-80 overflow-y-auto">
          {groups.map((group, groupIndex) => (
            <div key={group.agentKind}>
              {groupIndex > 0 ? <div className="my-1 border-t border-border-light" /> : null}
              <div className="min-h-6 truncate px-2 py-1 text-sm leading-4 text-foreground-tertiary">
                {group.agentDisplayName}
              </div>
              {group.models.map((model) => (
                <PopoverMenuItem
                  key={`${group.agentKind}:${model.id}`}
                  icon={<ProviderIcon kind={group.agentKind} className="size-3.5" />}
                  label={model.label}
                  trailing={group.agentKind === agentKind && model.id === selectedModelId
                    ? <Check className="size-3.5 shrink-0 text-foreground/60" />
                    : null}
                  onClick={() => {
                    onSelectModel(group.agentKind, model.id);
                    close();
                  }}
                >
                  {model.detail ? (
                    <span className="block truncate text-sm leading-4 text-foreground-tertiary">
                      {model.detail}
                    </span>
                  ) : null}
                </PopoverMenuItem>
              ))}
            </div>
          ))}
        </div>
      )}
    </PopoverButton>
  );
}
