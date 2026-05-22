import { useMemo, useState } from "react";
import { PickerEmptyRow, PickerPopoverContent } from "@/components/ui/PickerPopoverContent";
import { PillControlButton } from "@/components/ui/PillControlButton";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Brain, Check, Sparkles } from "@/components/ui/icons";
import { matchesPickerSearch } from "@/lib/infra/search/search";

interface AutomationAgentRunConfigOption {
  id: string;
  name?: string | null;
  agentKind?: string | null;
  modelId?: string | null;
  ownerScope?: string | null;
}

interface AutomationAgentRunConfigPickerProps {
  configs: AutomationAgentRunConfigOption[];
  selectedConfigId: string | null;
  isLoading: boolean;
  disabledReason: string | null;
  onSelect: (config: AutomationAgentRunConfigOption | null) => void;
}

const POPOVER_CLASS = "w-80 rounded-xl border border-border bg-popover p-1 shadow-floating";

export function AutomationAgentRunConfigPicker({
  configs,
  selectedConfigId,
  isLoading,
  disabledReason,
  onSelect,
}: AutomationAgentRunConfigPickerProps) {
  const [searchValue, setSearchValue] = useState("");
  const selectedConfig = configs.find((config) => config.id === selectedConfigId) ?? null;
  const filteredConfigs = useMemo(
    () => configs.filter((config) =>
      matchesPickerSearch([
        agentRunConfigDisplayName(config),
        config.agentKind ?? "",
        config.modelId ?? "",
      ], searchValue)
    ),
    [configs, searchValue],
  );

  const triggerLabel = selectedConfig
    ? agentRunConfigDisplayName(selectedConfig)
    : selectedConfigId
      ? "Saved config unavailable"
      : "Runtime defaults";

  return (
    <PopoverButton
      trigger={(
        <PillControlButton
          aria-label="Agent run config"
          disabled={isLoading}
          icon={<Brain className="size-3.5 shrink-0 text-muted-foreground" />}
          label={isLoading ? "Loading configs" : triggerLabel}
          disclosure
          className="max-w-[16rem]"
        />
      )}
      side="top"
      className={POPOVER_CLASS}
    >
      {(close) => (
        <PickerPopoverContent
          searchValue={searchValue}
          searchPlaceholder="Search configs"
          onSearchChange={setSearchValue}
        >
          <PopoverMenuItem
            icon={<Sparkles className="size-3.5 text-muted-foreground" />}
            label="Runtime defaults"
            onClick={() => {
              onSelect(null);
              setSearchValue("");
              close();
            }}
            trailing={selectedConfigId === null
              ? <Check className="size-3.5 text-foreground/70" />
              : null}
          >
            <span className="block truncate">
              Use the default agent, model, and mode.
            </span>
          </PopoverMenuItem>
          {filteredConfigs.length === 0 ? (
            <PickerEmptyRow
              label={isLoading ? "Loading configs" : disabledReason ?? "No configs found"}
            />
          ) : (
            filteredConfigs.map((config) => (
              <PopoverMenuItem
                key={config.id}
                icon={<Brain className="size-3.5 text-muted-foreground" />}
                label={agentRunConfigDisplayName(config)}
                onClick={() => {
                  onSelect(config);
                  setSearchValue("");
                  close();
                }}
                trailing={config.id === selectedConfigId
                  ? <Check className="size-3.5 text-foreground/70" />
                  : null}
              >
                <span className="block truncate">
                  {agentRunConfigDescription(config)}
                </span>
              </PopoverMenuItem>
            ))
          )}
        </PickerPopoverContent>
      )}
    </PopoverButton>
  );
}

function agentRunConfigDisplayName(config: AutomationAgentRunConfigOption): string {
  return config.name || config.id;
}

function agentRunConfigDescription(config: AutomationAgentRunConfigOption): string {
  const modelLabel = [config.agentKind, config.modelId].filter(Boolean).join(" / ");
  const parts = [modelLabel || null, config.ownerScope].filter(Boolean);
  return parts.join(" - ") || "Agent run configuration";
}
