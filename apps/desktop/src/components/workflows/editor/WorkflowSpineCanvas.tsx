import type { DragEvent, ReactNode } from "react";
import {
  isParallelGroup,
  WORKFLOW_MAX_AGENTS,
  type WorkflowAgentNode,
  type WorkflowDefinition,
  type WorkflowStepKind,
} from "@proliferate/product-domain/workflows/definition";
import { stepIssues, type WorkflowIssue } from "@proliferate/product-domain/workflows/validation";
import type { SpineAddress } from "@proliferate/product-domain/workflows/spine-editing";
import { nodeOrdinalFor } from "@/lib/domain/workflows/spine-node-ordinal";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { MoreHorizontal, Plus } from "@proliferate/ui/icons";
import {
  WorkflowAddStepButton,
  WorkflowAgentBlockCard,
  WorkflowSpineConnector,
  WorkflowStepRow,
} from "./WorkflowAgentBlockCard";
import { WorkflowParallelGroupBlock } from "./WorkflowParallelGroupBlock";
import { WorkflowSetupSummaryCard } from "./WorkflowSetupSummaryCard";
import type { EditorAgent } from "./WorkflowStepPanel";

const STEP_KINDS: WorkflowStepKind[] = ["agent.prompt", "agent.emit", "agent.config", "shell.run", "scm.open_pr", "notify", "branch", "workflow.include"];

interface DragKey extends SpineAddress {
  stepIndex: number;
}

interface DragLane {
  spineIndex: number;
  laneIndex: number;
}

export interface WorkflowSpineCanvasProps {
  name: string;
  description: string;
  definition: WorkflowDefinition;
  issues: readonly WorkflowIssue[];
  agents: readonly EditorAgent[];
  functionProviderDisplayNames: ReadonlyMap<string, string>;
  triggerChips: readonly string[];
  setupOpen: boolean;
  selectedStep: DragKey | null;
  setupTarget: SpineAddress | null;
  totalAgentCount: number;
  dragKey: DragKey | null;
  onDragKeyChange: (key: DragKey | null) => void;
  dragSpineIndex: number | null;
  onDragSpineIndexChange: (index: number | null) => void;
  dragLane: DragLane | null;
  onDragLaneChange: (lane: DragLane | null) => void;
  onOpenSetup: () => void;
  onSelectAgent: (address: SpineAddress) => void;
  onSelectStep: (address: SpineAddress, stepIndex: number) => void;
  onAddStep: (address: SpineAddress, kind: WorkflowStepKind) => void;
  onReorderStep: (address: SpineAddress, from: number, to: number) => void;
  onDuplicateStep: (address: SpineAddress, stepIndex: number) => void;
  onDeleteStep: (address: SpineAddress, stepIndex: number) => void;
  onAddAgentNode: () => void;
  onAddAgentInParallel: () => void;
  onParallelizeEntry: (spineIndex: number) => void;
  onAddLane: (spineIndex: number) => void;
  onRemoveLane: (spineIndex: number, lane: string) => void;
  onDeleteSpineEntry: (spineIndex: number) => void;
  onReorderSpineEntry: (from: number, to: number) => void;
  onReorderLane: (spineIndex: number, from: number, to: number) => void;
}

/** Resolve a node's model id to its catalog display label. Falls back to the
 * raw id when not in the catalog (e.g. a probe-only variant). */
function resolveModelLabel(agents: readonly EditorAgent[], harnessKind: string, modelId: string): string {
  const agent = agents.find((a) => a.kind === harnessKind);
  return agent?.models.find((m) => m.id === modelId)?.label ?? modelId ?? "";
}

/** The flattened run-order step index (across the whole agents spine, lanes
 * lane-grouped in lane order) for a given (spineIndex, lane, stepIndex) —
 * matches `validateWorkflowDefinition`'s indexing (L30 / D-031). */
function flatStepIndex(definition: WorkflowDefinition, address: SpineAddress, stepIndex: number): number {
  let flat = 0;
  for (let i = 0; i < address.spineIndex; i += 1) {
    const entry = definition.agents[i]!;
    flat += isParallelGroup(entry)
      ? entry.parallel.reduce((n, node) => n + node.steps.length, 0)
      : entry.steps.length;
  }
  const entry = definition.agents[address.spineIndex];
  if (entry && isParallelGroup(entry)) {
    for (const node of entry.parallel) {
      if (node.slot === address.lane) {
        break;
      }
      flat += node.steps.length;
    }
  }
  return flat + stepIndex;
}

/** The routed-connector summary after a standalone agent: its branch step's
 * taken (continue) case + the values that end the run, in plain English. */
function routeAfter(node: WorkflowAgentNode): { taken: string; others?: string } | null {
  const branch = node.steps.find((step) => step.kind === "branch");
  if (!branch || branch.kind !== "branch" || !branch.on) {
    return null;
  }
  const taken = Object.entries(branch.cases).find(([, c]) => c.to === "continue");
  if (!taken) {
    return null;
  }
  const ends = Object.entries(branch.cases)
    .filter(([, c]) => c.to === "end")
    .map(([value]) => `"${value}"`);
  return {
    taken: `${branch.on} is "${taken[0]}"`,
    others: ends.length > 0 ? `${ends.join(", ")} ends the run` : undefined,
  };
}

/**
 * The editor's spine canvas (WS0B-U split of `WorkflowEditorScreen.tsx`): the
 * setup summary card, the agent-block/parallel-group spine joined by
 * connectors, and the add-agent verb row. All draft mutation is delegated to
 * the callback props — this component only renders and forwards.
 */
export function WorkflowSpineCanvas({
  name,
  description,
  definition,
  issues,
  agents,
  functionProviderDisplayNames,
  triggerChips,
  setupOpen,
  selectedStep,
  setupTarget,
  totalAgentCount,
  dragKey,
  onDragKeyChange,
  dragSpineIndex,
  onDragSpineIndexChange,
  dragLane,
  onDragLaneChange,
  onOpenSetup,
  onSelectAgent,
  onSelectStep,
  onAddStep,
  onReorderStep,
  onDuplicateStep,
  onDeleteStep,
  onAddAgentNode,
  onAddAgentInParallel,
  onParallelizeEntry,
  onAddLane,
  onRemoveLane,
  onDeleteSpineEntry,
  onReorderSpineEntry,
  onReorderLane,
}: WorkflowSpineCanvasProps) {
  const agentMenu = (
    address: SpineAddress,
    opts: {
      canMoveUp: boolean;
      canMoveDown: boolean;
      onMoveUp: () => void;
      onMoveDown: () => void;
      onDelete?: () => void;
      onAddParallel: () => void;
    },
  ) => (
    <PopoverButton
      stopPropagation
      align="end"
      side="bottom"
      className={`w-52 ${POPOVER_SURFACE_CLASS}`}
      trigger={(
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          aria-label="Agent actions"
          className="shrink-0 rounded p-0.5 text-faint transition-colors hover:bg-surface-elevated-secondary hover:text-muted-foreground"
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      )}
    >
      {(close) => (
        <div className="p-1">
          <PopoverMenuItem
            density="compact"
            label="Edit"
            onClick={() => { close(); onSelectAgent(address); }}
          />
          <PopoverMenuItem density="compact" label="Add agent in parallel" onClick={() => { close(); opts.onAddParallel(); }} />
          <PopoverMenuItem density="compact" label="Move up" disabled={!opts.canMoveUp} onClick={() => { close(); opts.onMoveUp(); }} />
          <PopoverMenuItem density="compact" label="Move down" disabled={!opts.canMoveDown} onClick={() => { close(); opts.onMoveDown(); }} />
          {opts.onDelete ? (
            <PopoverMenuItem
              density="compact"
              label="Delete agent"
              labelClassName="text-destructive"
              onClick={() => { close(); opts.onDelete!(); }}
            />
          ) : null}
        </div>
      )}
    </PopoverButton>
  );

  /** One agent node as a block card: header (slot/model → agent inspector) +
   * single-line step rows + the add-step affordance. Identical for a
   * standalone node and a lane; only the menu wiring differs. */
  const renderAgentBlock = (node: WorkflowAgentNode, address: SpineAddress, menu: ReactNode) => {
    const agentInvalid = issues.some(
      (issue) => issue.location.scope === "agent" && issue.location.nodeIndex === nodeOrdinalFor(definition, address),
    );
    return (
      <WorkflowAgentBlockCard
        node={node}
        modelLabel={resolveModelLabel(agents, node.harness, node.model)}
        selected={setupTarget?.spineIndex === address.spineIndex && setupTarget.lane === address.lane}
        invalid={agentInvalid}
        onSelect={() => onSelectAgent(address)}
        menu={menu}
      >
        {node.steps.map((step, stepIndex) => {
          const flatIndex = flatStepIndex(definition, address, stepIndex);
          const isSelected =
            selectedStep?.spineIndex === address.spineIndex
            && selectedStep.lane === address.lane
            && selectedStep.stepIndex === stepIndex;
          return (
            <div
              key={stepIndex}
              draggable
              onDragStart={() => onDragKeyChange({ ...address, stepIndex })}
              onDragOver={(event: DragEvent) => event.preventDefault()}
              onDrop={() => {
                if (dragKey !== null && dragKey.spineIndex === address.spineIndex && dragKey.lane === address.lane) {
                  onReorderStep(address, dragKey.stepIndex, stepIndex);
                }
                onDragKeyChange(null);
              }}
            >
              <WorkflowStepRow
                step={step}
                selected={isSelected}
                invalid={stepIssues(issues, flatIndex).length > 0}
                canMoveUp={stepIndex > 0}
                canMoveDown={stepIndex < node.steps.length - 1}
                onSelect={() => onSelectStep(address, stepIndex)}
                onMove={(dir) => onReorderStep(address, stepIndex, stepIndex + dir)}
                onDuplicate={() => onDuplicateStep(address, stepIndex)}
                onDelete={() => onDeleteStep(address, stepIndex)}
              />
            </div>
          );
        })}
        <WorkflowAddStepButton kinds={STEP_KINDS} onAdd={(kind) => onAddStep(address, kind)} />
      </WorkflowAgentBlockCard>
    );
  };

  return (
    <div className="min-w-0 overflow-y-auto bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] [background-size:16px_16px]">
      <div className="mx-auto flex max-w-2xl flex-col px-6 py-6">
        <WorkflowSetupSummaryCard
          name={name}
          description={description}
          inputs={definition.inputs}
          integrations={definition.integrations}
          functionProviderDisplayNames={functionProviderDisplayNames}
          triggerChips={triggerChips}
          setupOpen={setupOpen}
          onOpenSetup={onOpenSetup}
        />

        {/* Spine: agent block cards joined by connectors; a routed branch
            in the entry above summarizes its taken case on the connector.
            A parallel group is one framed entry whose lanes render
            side-by-side inside it. */}
        {definition.agents.map((entry, spineIndex) => {
          const previous = spineIndex > 0 ? definition.agents[spineIndex - 1] : null;
          const connector =
            spineIndex > 0 ? (
              <WorkflowSpineConnector
                route={previous && !isParallelGroup(previous) ? routeAfter(previous) : null}
              />
            ) : null;

          if (isParallelGroup(entry)) {
            return (
              <div key={spineIndex} className="contents">
                {connector}
                <div
                  draggable
                  onDragStart={() => onDragSpineIndexChange(spineIndex)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragSpineIndex !== null) {
                      onReorderSpineEntry(dragSpineIndex, spineIndex);
                    }
                    onDragSpineIndexChange(null);
                  }}
                >
                  <WorkflowParallelGroupBlock
                    entry={entry}
                    spineIndex={spineIndex}
                    isLastSpineEntry={spineIndex >= definition.agents.length - 1}
                    dragLane={dragLane}
                    onDragLaneChange={onDragLaneChange}
                    onReorderSpineEntry={onReorderSpineEntry}
                    onAddLane={onAddLane}
                    onReorderLane={onReorderLane}
                    onRemoveLane={onRemoveLane}
                    renderAgentBlock={renderAgentBlock}
                    agentMenu={agentMenu}
                  />
                </div>
              </div>
            );
          }

          const address: SpineAddress = { spineIndex, lane: "-" };
          return (
            <div key={spineIndex} className="contents">
              {connector}
              <div
                draggable
                onDragStart={() => onDragSpineIndexChange(spineIndex)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragSpineIndex !== null) {
                    onReorderSpineEntry(dragSpineIndex, spineIndex);
                  }
                  onDragSpineIndexChange(null);
                }}
              >
                {renderAgentBlock(entry, address, agentMenu(address, {
                  canMoveUp: spineIndex > 0,
                  canMoveDown: spineIndex < definition.agents.length - 1,
                  onMoveUp: () => onReorderSpineEntry(spineIndex, spineIndex - 1),
                  onMoveDown: () => onReorderSpineEntry(spineIndex, spineIndex + 1),
                  onDelete: totalAgentCount > 1 ? () => onDeleteSpineEntry(spineIndex) : undefined,
                  onAddParallel: () => onParallelizeEntry(spineIndex),
                }))}
              </div>
            </div>
          );
        })}

        {/* Add-agent verbs (mock: quiet pill buttons under the spine). */}
        <div className="flex items-center justify-center gap-2 py-3">
          <Button
            type="button"
            variant="unstyled"
            size="unstyled"
            onClick={onAddAgentNode}
            disabled={totalAgentCount >= WORKFLOW_MAX_AGENTS}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground shadow-sm transition-colors hover:border-border-heavy hover:text-foreground disabled:opacity-50"
          >
            <Plus className="size-3" />
            Agent below
          </Button>
          <Button
            type="button"
            variant="unstyled"
            size="unstyled"
            onClick={onAddAgentInParallel}
            disabled={totalAgentCount >= WORKFLOW_MAX_AGENTS || definition.agents.length === 0}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground shadow-sm transition-colors hover:border-border-heavy hover:text-foreground disabled:opacity-50"
          >
            <Plus className="size-3" />
            In parallel with the last
          </Button>
        </div>
      </div>
    </div>
  );
}
