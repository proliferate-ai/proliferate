import type { WorkflowAgentNode, WorkflowDefinition, WorkflowParallelGroup } from "@proliferate/product-domain/workflows/definition";
import { isParallelGroup } from "@proliferate/product-domain/workflows/definition";
import type { WorkflowIssue } from "@proliferate/product-domain/workflows/validation";
import { getSpineNode, type SpineAddress } from "@proliferate/product-domain/workflows/spine-editing";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Robot, X } from "@proliferate/ui/icons";
import { nodeOrdinalFor } from "@/lib/domain/workflows/spine-node-ordinal";
import { WorkflowAgentIntegrationsRow } from "./WorkflowFunctionsCard";
import type { EditorAgent } from "./WorkflowStepPanel";
import { WorkflowSelect } from "./WorkflowSelect";

export interface WorkflowAgentInspectorProps {
  definition: WorkflowDefinition;
  setupTarget: SpineAddress;
  issues: readonly WorkflowIssue[];
  agents: readonly EditorAgent[];
  functionProviderDisplayNames: ReadonlyMap<string, string>;
  onPatchNode: (address: SpineAddress, next: Partial<WorkflowAgentNode>) => void;
  onSetModel: (address: SpineAddress, model: string) => void;
  onMarkDirty: () => void;
  onRemoveLane: (spineIndex: number, lane: string) => void;
  onClose: () => void;
}

/** The editor's Agent inspector panel: slot name, agent/model pickers,
 * per-agent integration narrowing, and (for a lane) "remove from group". */
export function WorkflowAgentInspector({
  definition,
  setupTarget,
  issues,
  agents,
  functionProviderDisplayNames,
  onPatchNode,
  onSetModel,
  onMarkDirty,
  onRemoveLane,
  onClose,
}: WorkflowAgentInspectorProps) {
  const node = getSpineNode(definition.agents, setupTarget);
  if (!node) {
    return null;
  }

  const slotIssue = issues.find(
    (issue) =>
      issue.location.scope === "agent" &&
      issue.location.nodeIndex === nodeOrdinalFor(definition, setupTarget) &&
      issue.location.field === "slot",
  );

  return (
    <div className="flex h-full flex-col overflow-hidden border-l border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="inline-flex select-none items-center gap-1.5 rounded-full border border-border bg-transparent px-3 py-0.5 text-xs font-medium leading-none text-foreground">
          <Robot className="size-3.5 shrink-0 text-foreground" />
          <span>Agent</span>
        </span>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close panel">
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <span className="w-28 shrink-0 text-sm text-muted-foreground">Name</span>
            <div className="flex flex-1 justify-end">
              <Input
                aria-label="Agent name"
                value={node.slot}
                placeholder="agent_1"
                className="font-mono"
                onChange={(event) => onPatchNode(setupTarget, { slot: event.target.value })}
              />
            </div>
          </div>
          {slotIssue ? (
            <p className="-mt-2 text-xs text-destructive">{slotIssue.message}</p>
          ) : (
            <p className="-mt-2 text-xs text-faint">
              Identifies this agent's session across runs — lowercase letters, digits, underscores.
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="w-28 shrink-0 text-sm text-muted-foreground">Agent</span>
            <div className="flex flex-1 justify-end">
              <WorkflowSelect
                ariaLabel="Agent"
                value={node.harness || ""}
                placeholder="Select agent"
                options={agents.map((agent) => ({ value: agent.kind, label: agent.displayName }))}
                onChange={(harness) => {
                  onMarkDirty();
                  const next = agents.find((agent) => agent.kind === harness);
                  onPatchNode(setupTarget, { harness, model: next?.models[0]?.id ?? "" });
                }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="w-28 shrink-0 text-sm text-muted-foreground">Model</span>
            <div className="flex flex-1 justify-end">
              <WorkflowSelect
                ariaLabel="Model"
                value={node.model || ""}
                placeholder="Select model"
                disabled={(agents.find((a) => a.kind === node.harness)?.models ?? []).length === 0}
                options={(agents.find((a) => a.kind === node.harness)?.models ?? []).map((model) => ({ value: model.id, label: model.label }))}
                onChange={(model) => onSetModel(setupTarget, model)}
              />
            </div>
          </div>
          {definition.integrations.length > 0 ? (
            <div className="border-t border-border/60 pt-3">
              <WorkflowAgentIntegrationsRow
                workflowIntegrations={definition.integrations}
                displayNames={functionProviderDisplayNames}
                value={node.integrations}
                onChange={(next) => {
                  onMarkDirty();
                  onPatchNode(setupTarget, { integrations: next });
                }}
              />
            </div>
          ) : null}
          {setupTarget.lane !== "-" && isParallelGroup(definition.agents[setupTarget.spineIndex]!) ? (
            <div className="flex flex-col gap-1.5 border-t border-border pt-4">
              <p className="text-xs text-muted-foreground">
                A lane in a "Run together" group — it runs concurrently with{" "}
                {(definition.agents[setupTarget.spineIndex] as WorkflowParallelGroup).parallel.length - 1}{" "}
                other agent(s); all lanes join before the run continues.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() => onRemoveLane(setupTarget.spineIndex, setupTarget.lane)}
              >
                Remove from group
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
