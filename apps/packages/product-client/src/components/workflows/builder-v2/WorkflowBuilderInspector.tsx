import { useMemo } from "react";
import type {
  WorkflowBuilderActions,
  WorkflowBuilderDraft,
} from "#product/hooks/workflows/facade/use-workflow-builder";
import type { WorkflowBuilderHarnessOption } from "#product/lib/domain/workflows/workflow-builder-authoring";
import type { WorkflowBuilderIssue } from "#product/lib/domain/workflows/workflow-builder-validation";
import type { WorkflowBuilderSelection } from "#product/lib/domain/workflows/workflow-builder-selection";
import type { WorkflowRepoRootOption } from "#product/lib/domain/workflows/workflow-repo-root-options";
import { WorkflowBuilderDetailsCard } from "#product/components/workflows/builder-v2/WorkflowBuilderDetailsCard";
import { WorkflowBuilderDocInspector } from "#product/components/workflows/builder-v2/WorkflowBuilderDocInspector";
import { WorkflowBuilderInputsPanel } from "#product/components/workflows/builder-v2/WorkflowBuilderInputsPanel";
import { WorkflowBuilderNodeCard } from "#product/components/workflows/builder-v2/WorkflowBuilderNodeCard";

export interface WorkflowBuilderInspectorProps {
  selection: WorkflowBuilderSelection;
  draft: WorkflowBuilderDraft;
  issues: WorkflowBuilderIssue[];
  actions: WorkflowBuilderActions;
  harnesses: WorkflowBuilderHarnessOption[];
  repositories: WorkflowRepoRootOption[];
  repositoriesLoading: boolean;
  repoDefaultUnavailable: boolean;
  disabled: boolean;
}

/** Right pane: whichever card the current selection resolves to. */
export function WorkflowBuilderInspector({
  selection,
  draft,
  issues,
  actions,
  harnesses,
  repositories,
  repositoriesLoading,
  repoDefaultUnavailable,
  disabled,
}: WorkflowBuilderInspectorProps) {
  const inputNames = useMemo(
    () => new Set(draft.inputs.map((input) => input.name)),
    [draft.inputs],
  );
  const docSlugs = useMemo(
    () => new Set(draft.docTemplates.map((doc) => doc.slug)),
    [draft.docTemplates],
  );
  const selectedNode = selection.kind === "node"
    ? draft.nodes.find((node) => node.id === selection.id) ?? null
    : null;
  const selectedDoc = selection.kind === "doc" ? draft.docTemplates[selection.index] : null;

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border/70 p-3">
      {selection.kind === "input" ? (
        <>
          <WorkflowBuilderDetailsCard
            description={draft.description}
            defaultRepoConfigId={draft.defaultRepoConfigId}
            repositories={repositories}
            repositoriesLoading={repositoriesLoading}
            repoDefaultUnavailable={repoDefaultUnavailable}
            disabled={disabled}
            onDescriptionChange={actions.setDescription}
            onDefaultRepoConfigIdChange={actions.setDefaultRepoConfigId}
          />
          <WorkflowBuilderInputsPanel
            inputs={draft.inputs}
            issues={issues}
            disabled={disabled}
            onAdd={actions.addInput}
            onRemove={actions.removeInput}
            onChange={actions.updateInput}
          />
        </>
      ) : null}

      {selectedNode ? (
        <WorkflowBuilderNodeCard
          key={selectedNode.id}
          node={selectedNode}
          position={draft.nodes.findIndex((node) => node.id === selectedNode.id) + 1}
          nodeCount={draft.nodes.length}
          harnesses={harnesses}
          issues={issues.filter((issue) => issue.nodeId === selectedNode.id)}
          inputNames={inputNames}
          docSlugs={docSlugs}
          disabled={disabled}
          onChange={(patch) => actions.updateNode(selectedNode.id, patch)}
          onRemove={() => actions.removeNode(selectedNode.id)}
          onMoveUp={() => actions.moveNodeUp(selectedNode.id)}
          onMoveDown={() => actions.moveNodeDown(selectedNode.id)}
          onAddLeg={() => actions.addLeg(selectedNode.id)}
          onRemoveLeg={(legIndex) => actions.removeLeg(selectedNode.id, legIndex)}
          onUpdateLeg={(legIndex, prompt) => actions.updateLeg(selectedNode.id, legIndex, prompt)}
        />
      ) : null}

      {selectedDoc && selection.kind === "doc" ? (
        <WorkflowBuilderDocInspector
          key={selection.index}
          doc={selectedDoc}
          index={selection.index}
          nodes={draft.nodes}
          issues={issues}
          disabled={disabled}
          onRemove={() => actions.removeDocTemplate(selection.index)}
          onChange={(patch) => actions.updateDocTemplate(selection.index, patch)}
        />
      ) : null}
    </aside>
  );
}
