import { useEffect, useMemo, useRef, useState } from "react";
import { useRepoRootsQuery } from "@anyharness/sdk-react";
import type { WorkflowStarterTemplateV2 } from "#product/config/workflows/starter-templates";
import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import { useCloudLaunchModelRegistries } from "#product/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { useWorkflowBuilder } from "#product/hooks/workflows/facade/use-workflow-builder";
import { workflowBuilderHarnessOptions } from "#product/lib/domain/workflows/workflow-builder-authoring";
import { workflowRepoRootOptions } from "#product/lib/domain/workflows/workflow-repo-root-options";
import { WorkflowBuilderChainCanvas } from "#product/components/workflows/builder-v2/WorkflowBuilderChainCanvas";
import { WorkflowBuilderDetailsCard } from "#product/components/workflows/builder-v2/WorkflowBuilderDetailsCard";
import { WorkflowBuilderDocsPanel } from "#product/components/workflows/builder-v2/WorkflowBuilderDocsPanel";
import { WorkflowBuilderInputsPanel } from "#product/components/workflows/builder-v2/WorkflowBuilderInputsPanel";
import { WorkflowBuilderNodeCard } from "#product/components/workflows/builder-v2/WorkflowBuilderNodeCard";
import { WorkflowResourceState } from "#product/components/workflows/WorkflowResourceState";
import { Button } from "#product/primitives/Button";
import { Plus } from "#product/primitives/icons/core";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";
import { ProductPageShell } from "#product/primitives/patterns/ProductPageShell";

export interface WorkflowBuilderSurfaceProps {
  /** `null` = a new workflow, blank or seeded from `template`. */
  definitionId: string | null;
  template?: WorkflowStarterTemplateV2 | null;
  /** Per-account cache scope every workflows surface threads from the page. */
  authCacheScope: string;
  onSaved?: (definitionId: string) => void;
  onBack?: () => void;
}

/**
 * The gen-2 builder: a vertical chain of step cards, the inputs they read, and
 * the documents they hand forward.
 *
 * There is no canvas and no edge editing — the chain is the card order, and
 * `useWorkflowBuilder` renders it as the linear edge list a save sends. Every
 * rule the surface enforces comes from `validateDefinitionV2` through that
 * hook; this component only decides where each issue is shown.
 */
export function WorkflowBuilderSurface({
  definitionId,
  template = null,
  authCacheScope,
  onSaved,
  onBack,
}: WorkflowBuilderSurfaceProps) {
  // Runtime repo roots, the same source `WorkflowTriggerDialog` picks a run's
  // repository from. No `enabled` gate: unlike the dialog's `open`, this surface
  // is only mounted while a workflow is being edited, and the query already
  // disables itself when no runtime is connected.
  const repoRootsQuery = useRepoRootsQuery();
  const repositories = useMemo(
    () => workflowRepoRootOptions(repoRootsQuery.data ?? []),
    [repoRootsQuery.data],
  );
  // `null` while the list is unknown: an id cannot be confirmed against a list
  // that has not arrived, and confirming it is what the save gate needs.
  const availableRepoRootIds = repoRootsQuery.data
    ? repoRootsQuery.data.map((repoRoot) => repoRoot.id)
    : null;
  const builder = useWorkflowBuilder({
    definitionId,
    template,
    authCacheScope,
    availableRepoRootIds,
  });
  const registriesQuery = useCloudLaunchModelRegistries();
  const harnesses = useMemo(
    () => workflowBuilderHarnessOptions(registriesQuery.data),
    [registriesQuery.data],
  );

  const { draft, issues, actions } = builder;
  const inputNames = useMemo(
    () => new Set(draft.inputs.map((input) => input.name)),
    [draft.inputs],
  );
  const docSlugs = useMemo(
    () => new Set(draft.docTemplates.map((doc) => doc.slug)),
    [draft.docTemplates],
  );

  // Canvas selection is presentation state: the inspector under the canvas
  // edits exactly one step. It falls back to the first step (a chain always
  // reads top-down), and a just-added step selects itself so "Add step" lands
  // the user in the fields they came for.
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const previousNodeCountRef = useRef(draft.nodes.length);
  useEffect(() => {
    if (draft.nodes.length > previousNodeCountRef.current) {
      setSelectedNodeId(draft.nodes[draft.nodes.length - 1].id);
    }
    previousNodeCountRef.current = draft.nodes.length;
  }, [draft.nodes]);
  const selectedNode = draft.nodes.find((node) => node.id === selectedNodeId)
    ?? draft.nodes[0]
    ?? null;
  const issueNodeIds = useMemo(
    () => new Set(
      issues.flatMap((issue) => (issue.nodeId ? [issue.nodeId] : [])),
    ),
    [issues],
  );

  if (builder.status !== "ready") {
    return (
      <WorkflowResourceState
        loading={builder.status === "loading"}
        title={resourceStateTitle(builder.status)}
        description={resourceStateDescription(builder.status)}
        onBack={() => onBack?.()}
        onRetry={builder.status === "missing" ? builder.reload : undefined}
      />
    );
  }

  const submit = () => {
    void builder.save().then((saved) => {
      if (saved) {
        onSaved?.(saved.id);
      }
    });
  };

  return (
    <ProductPageShell
      title={draft.title.trim() || (definitionId === null
        ? WORKFLOW_BUILDER_COPY.newPageTitle
        : WORKFLOW_BUILDER_COPY.untitledPageTitle)}
      description={WORKFLOW_BUILDER_COPY.pageDescription}
      actions={(
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="md"
            disabled={builder.saving}
            onClick={() => onBack?.()}
          >
            {WORKFLOW_BUILDER_COPY.backLabel}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            loading={builder.saving}
            disabled={!builder.canSave}
            onClick={submit}
          >
            {saveLabel(builder.saving, builder.saved)}
          </Button>
        </div>
      )}
      maxWidthClassName="max-w-4xl"
      telemetryBlocked
    >
      <div className="space-y-4">
        {builder.error ? (
          <NoticeBanner tone="destructive">{builder.error}</NoticeBanner>
        ) : null}
        {issues.length > 0 ? (
          <NoticeBanner tone="destructive">
            {WORKFLOW_BUILDER_COPY.issuesBanner(issues.length, issues[0].message)}
          </NoticeBanner>
        ) : null}
        {registriesQuery.isError ? (
          <NoticeBanner tone="warning">
            {WORKFLOW_BUILDER_COPY.catalogUnavailable}
          </NoticeBanner>
        ) : null}
        {repoRootsQuery.isError ? (
          <NoticeBanner tone="warning">
            {WORKFLOW_BUILDER_COPY.repositoriesLoadFailed}
          </NoticeBanner>
        ) : null}

        <WorkflowBuilderDetailsCard
          title={draft.title}
          description={draft.description}
          defaultRepoConfigId={draft.defaultRepoConfigId}
          repositories={repositories}
          repositoriesLoading={repoRootsQuery.isLoading}
          repoDefaultUnavailable={builder.repoDefaultUnavailable}
          disabled={builder.saving}
          onTitleChange={actions.setTitle}
          onDescriptionChange={actions.setDescription}
          onDefaultRepoConfigIdChange={actions.setDefaultRepoConfigId}
        />

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-heading font-medium text-foreground">
              {WORKFLOW_BUILDER_COPY.stepsHeading}
            </h2>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={builder.saving}
              onClick={actions.addNode}
            >
              <Plus className="icon-paired" aria-hidden />
              {WORKFLOW_BUILDER_COPY.addStepLabel}
            </Button>
          </div>

          {draft.nodes.length > 0 ? (
            <WorkflowBuilderChainCanvas
              className="h-96"
              nodes={draft.nodes}
              selectedNodeId={selectedNode?.id ?? null}
              issueNodeIds={issueNodeIds}
              onSelectNode={setSelectedNodeId}
            />
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
              disabled={builder.saving}
              onChange={(patch) => actions.updateNode(selectedNode.id, patch)}
              onRemove={() => actions.removeNode(selectedNode.id)}
              onMoveUp={() => actions.moveNodeUp(selectedNode.id)}
              onMoveDown={() => actions.moveNodeDown(selectedNode.id)}
            />
          ) : null}
        </section>

        <WorkflowBuilderInputsPanel
          inputs={draft.inputs}
          issues={issues}
          disabled={builder.saving}
          onAdd={actions.addInput}
          onRemove={actions.removeInput}
          onChange={actions.updateInput}
        />

        <WorkflowBuilderDocsPanel
          docTemplates={draft.docTemplates}
          nodes={draft.nodes}
          issues={issues}
          disabled={builder.saving}
          onAdd={actions.addDocTemplate}
          onRemove={actions.removeDocTemplate}
          onChange={actions.updateDocTemplate}
        />
      </div>
    </ProductPageShell>
  );
}

function saveLabel(saving: boolean, saved: boolean): string {
  if (saving) {
    return WORKFLOW_BUILDER_COPY.savingLabel;
  }
  return saved ? WORKFLOW_BUILDER_COPY.savedLabel : WORKFLOW_BUILDER_COPY.saveLabel;
}

function resourceStateTitle(status: "loading" | "missing" | "unsupported"): string {
  if (status === "loading") {
    return WORKFLOW_BUILDER_COPY.loadingTitle;
  }
  return status === "unsupported"
    ? WORKFLOW_BUILDER_COPY.unsupportedTitle
    : WORKFLOW_BUILDER_COPY.missingTitle;
}

function resourceStateDescription(status: "loading" | "missing" | "unsupported"): string {
  if (status === "loading") {
    return WORKFLOW_BUILDER_COPY.loadingDescription;
  }
  return status === "unsupported"
    ? WORKFLOW_BUILDER_COPY.unsupportedDescription
    : WORKFLOW_BUILDER_COPY.missingDescription;
}
