import type {
  AutomationModelGroup,
  AutomationModelResolution,
  AutomationModelSelection,
} from "@/lib/domain/automations/model-selection";
import { PickerEmptyRow, PickerPopoverContent } from "@/components/ui/PickerPopoverContent";
import { PillControlButton } from "@/components/ui/PillControlButton";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Check, ProviderIcon, Sparkles } from "@/components/ui/icons";

interface AutomationModelPickerProps {
  groups: AutomationModelGroup[];
  resolution: AutomationModelResolution;
  isLoading: boolean;
  disabledReason: string | null;
  onSelect: (selection: AutomationModelSelection) => void;
  onDefaultSelect: () => void;
}

const POPOVER_CLASS = "w-80 rounded-xl border border-border bg-popover p-1 shadow-floating";

export function AutomationModelPicker({
  groups,
  resolution,
  isLoading,
  disabledReason,
  onSelect,
  onDefaultSelect,
}: AutomationModelPickerProps) {
  const trigger = resolveTrigger(resolution, isLoading, disabledReason);
  const selected = resolution.state === "selected"
    ? resolution.selection
    : resolution.state === "default"
      ? resolution.selection
      : null;
  const canSelectDefaultModel = resolution.submission.canSubmit
    && Boolean(resolution.submission.agentKind);

  return (
    <PopoverButton
      trigger={(
        <PillControlButton
          aria-label="Model"
          disabled={isLoading || groups.length === 0}
          icon={trigger.agentKind
            ? <ProviderIcon kind={trigger.agentKind} className="size-3.5 shrink-0" />
            : <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />}
          label={trigger.label}
          disclosure
          className="max-w-[14rem]"
        />
      )}
      side="top"
      className={POPOVER_CLASS}
    >
      {(close) => (
        <PickerPopoverContent>
          {groups.length === 0 ? (
            <PickerEmptyRow label={isLoading ? "Loading models" : "No ready models"} />
          ) : (
            <>
              {canSelectDefaultModel && (
                <PopoverMenuItem
                  label="Default model"
                  icon={<Sparkles className="size-3.5 text-muted-foreground" />}
                  onClick={() => {
                    onDefaultSelect();
                    close();
                  }}
                  trailing={resolution.state === "default" && resolution.source !== "create"
                    ? <Check className="size-3.5 text-foreground/70" />
                    : null}
                >
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    Use the runtime default for the selected agent
                  </span>
                </PopoverMenuItem>
              )}
              {groups.map((group) => (
                <div key={group.kind} className="py-1">
                  <div className="flex items-center gap-2 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    <ProviderIcon kind={group.kind} className="size-3.5 shrink-0" />
                    <span className="truncate">{group.providerDisplayName}</span>
                  </div>
                  {group.models.map((model) => (
                    <PopoverMenuItem
                      key={`${model.kind}:${model.modelId}`}
                      label={model.displayName}
                      onClick={() => {
                        onSelect({ kind: model.kind, modelId: model.modelId });
                        close();
                      }}
                      trailing={selected?.kind === model.kind && selected.modelId === model.modelId
                        ? <Check className="size-3.5 text-foreground/70" />
                        : null}
                    />
                  ))}
                </div>
              ))}
            </>
          )}
        </PickerPopoverContent>
      )}
    </PopoverButton>
  );
}

function resolveTrigger(
  resolution: AutomationModelResolution,
  isLoading: boolean,
  disabledReason: string | null,
): { label: string; agentKind: string | null } {
  if (isLoading) {
    return { label: "Loading models", agentKind: null };
  }
  if (resolution.state === "selected") {
    return {
      label: `${resolution.group.providerDisplayName} · ${resolution.model.displayName}`,
      agentKind: resolution.selection.kind,
    };
  }
  if (resolution.state === "default") {
    return {
      label: resolution.source === "savedNull" || resolution.source === "overrideNull"
        ? "Default model"
        : resolution.group && resolution.model
          ? `${resolution.group.providerDisplayName} · ${resolution.model.displayName}`
          : "Default model",
      agentKind: resolution.submission.agentKind,
    };
  }
  if (resolution.state === "savedUnavailable") {
    return {
      label: resolution.reason === "missingAgent" || resolution.reason === "unsupportedAgent"
        ? "Choose model"
        : "Saved model unavailable",
      agentKind: resolution.savedAgentKind,
    };
  }
  return { label: disabledReason ?? "No ready models", agentKind: null };
}
