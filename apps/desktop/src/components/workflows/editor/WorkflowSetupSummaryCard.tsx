import type { WorkflowInputSpec } from "@proliferate/product-domain/workflows/definition";
import { IntegrationIcon } from "@/components/settings/panes/integrations/IntegrationIcon";

export interface WorkflowSetupSummaryCardProps {
  name: string;
  description: string;
  inputs: readonly WorkflowInputSpec[];
  integrations: readonly string[];
  functionProviderDisplayNames: ReadonlyMap<string, string>;
  triggerChips: readonly string[];
  setupOpen: boolean;
  onOpenSetup: () => void;
}

/** Setup summary card (editor page of record): title, description, input +
 * integration facts at a glance; clicking opens the setup inspector where the
 * actual editing lives. */
export function WorkflowSetupSummaryCard({
  name,
  description,
  inputs,
  integrations,
  functionProviderDisplayNames,
  triggerChips,
  setupOpen,
  onOpenSetup,
}: WorkflowSetupSummaryCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenSetup}
      className={`mb-4 flex cursor-pointer flex-col gap-2 rounded-xl border bg-background p-3 shadow-sm transition-colors ${
        setupOpen ? "border-border-heavy" : "border-border hover:border-border-heavy"
      }`}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{name || "Untitled workflow"}</span>
        {description ? (
          <span className="text-xs text-muted-foreground" data-telemetry-mask>{description}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">Inputs</span>
        {inputs.length > 0 ? (
          inputs.map((input) => (
            <span
              key={input.name}
              className="inline-flex shrink-0 select-none items-center gap-1 rounded-full bg-surface-elevated-secondary px-2 py-0.5 font-mono text-xs leading-4 text-muted-foreground"
            >
              {input.name || "…"}
            </span>
          ))
        ) : (
          <span className="text-xs text-faint">none</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">Integrations</span>
        {integrations.length > 0 ? (
          integrations.map((namespace) => (
            <span key={namespace} className="inline-flex items-center gap-1.5">
              <IntegrationIcon namespace={namespace} className="size-4 rounded" />
              <span className="text-xs text-muted-foreground">
                {functionProviderDisplayNames.get(namespace) ?? namespace}
              </span>
            </span>
          ))
        ) : (
          <span className="text-xs text-faint">none</span>
        )}
      </div>
      {triggerChips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">Triggers</span>
          {triggerChips.map((chip) => (
            <span
              key={chip}
              className="inline-flex shrink-0 select-none items-center gap-1 rounded-full bg-surface-elevated-secondary px-2 py-0.5 text-xs leading-4 text-muted-foreground"
            >
              {chip}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
