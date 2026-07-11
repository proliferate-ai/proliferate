import type { WorkflowInputSpec } from "@proliferate/product-domain/workflows/definition";
import { Button } from "@proliferate/ui/primitives/Button";
import { X } from "@proliferate/ui/icons";
import { WorkflowMetaCard } from "./WorkflowMetaCard";
import { WorkflowSetupCard } from "./WorkflowSetupCard";
import { WorkflowTriggersCard, type WorkflowTriggerRepoOption } from "./WorkflowTriggersCard";
import { WorkflowFunctionsCard, type WorkflowFunctionProviderOption } from "./WorkflowFunctionsCard";
import type { EditorAgent } from "./WorkflowStepPanel";

export interface WorkflowSetupInspectorProps {
  workflowId: string;
  name: string;
  description: string;
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string) => void;
  inputs: WorkflowInputSpec[];
  agents: readonly EditorAgent[];
  onInputsChange: (inputs: WorkflowInputSpec[]) => void;
  integrations: readonly string[];
  functionProviders: readonly WorkflowFunctionProviderOption[];
  onIntegrationsChange: (integrations: string[]) => void;
  repoOptions: readonly WorkflowTriggerRepoOption[];
  localRepoOptions: readonly WorkflowTriggerRepoOption[];
  onOpenRun: (runId: string) => void;
  onClose: () => void;
}

/** The editor's Setup inspector panel: name/description, inputs, integrations,
 * and triggers — the setup summary card (canvas) opens it. */
export function WorkflowSetupInspector({
  workflowId,
  name,
  description,
  onNameChange,
  onDescriptionChange,
  inputs,
  agents,
  onInputsChange,
  integrations,
  functionProviders,
  onIntegrationsChange,
  repoOptions,
  localRepoOptions,
  onOpenRun,
  onClose,
}: WorkflowSetupInspectorProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden border-l border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="inline-flex select-none items-center gap-1.5 rounded-full border border-border bg-transparent px-3 py-0.5 text-xs font-medium leading-none text-foreground">
          Setup
        </span>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close panel">
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-3">
          <WorkflowMetaCard
            name={name}
            description={description}
            onNameChange={onNameChange}
            onDescriptionChange={onDescriptionChange}
          />
          <WorkflowSetupCard inputs={inputs} agents={agents} onInputsChange={onInputsChange} />
          <WorkflowFunctionsCard
            integrations={integrations}
            providers={functionProviders}
            onChange={onIntegrationsChange}
          />
          <WorkflowTriggersCard
            workflowId={workflowId}
            args={inputs}
            repoOptions={repoOptions}
            localRepoOptions={localRepoOptions}
            onOpenRun={onOpenRun}
          />
        </div>
      </div>
    </div>
  );
}
