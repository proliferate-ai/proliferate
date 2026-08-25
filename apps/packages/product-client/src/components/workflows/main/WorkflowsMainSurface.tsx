import { useState } from "react";
import type { WorkflowDefinitionRecordV2 } from "@proliferate/cloud-sdk";
import type { WorkflowStarterTemplateV2 } from "#product/config/workflows/starter-templates";
import { WORKFLOW_MAIN_COPY } from "#product/copy/workflows/workflow-main-copy";
import {
  useWorkflowDefinitionsV2ListAccess,
  useWorkflowDefinitionV2Access,
  useWorkflowDefinitionV2MutationsAccess,
} from "#product/hooks/access/cloud/workflows/use-workflow-definitions-v2-access";
import { useWorkspaceNavigationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import {
  selectWorkflowV2DefinitionRows,
  workflowRunDefinitionTitle,
  type WorkflowMainListItem,
} from "#product/domain/workflows/main-view-model";
import { WorkflowMainDefinitionRow } from "#product/components/workflows/main/WorkflowMainDefinitionRow";
import { WorkflowMainDeleteDialog } from "#product/components/workflows/main/WorkflowMainDeleteDialog";
import { WorkflowMainEmptyState } from "#product/components/workflows/main/WorkflowMainEmptyState";
import { WorkflowMainExecutionsGroup } from "#product/components/workflows/main/WorkflowMainExecutionsGroup";
import { WorkflowMainNewMenu } from "#product/components/workflows/main/WorkflowMainNewMenu";
import { WorkflowTriggerDialog } from "#product/components/workflows/trigger/WorkflowTriggerDialog";
import { useWorkflowExecutions } from "#product/hooks/workflows/facade/use-workflow-executions";
import type { WorkflowTriggerLaunch } from "#product/hooks/workflows/workflows/use-workflow-trigger-actions";
import { Button } from "#product/primitives/Button";
import { Input } from "#product/primitives/Input";
import { RotateCcw, Search } from "#product/primitives/icons/core";
import { Card } from "#product/primitives/patterns/Card";
import { EmptyState } from "#product/primitives/patterns/EmptyState";
import { ProductPageShell } from "#product/primitives/patterns/ProductPageShell";

export interface WorkflowsMainSurfaceProps {
  authCacheScope: string;
  onEdit: (definitionId: string) => void;
  onNew: (template: WorkflowStarterTemplateV2 | null) => void;
}

/**
 * The Workflows gen-2 main page: the list of a user's saved (schema_version 2)
 * definitions, the entry points onto the builder (blank or from a starter
 * template), and the Run/Edit/Delete row actions.
 *
 * Split at the row (`WorkflowMainDefinitionRow`), the empty state
 * (`WorkflowMainEmptyState`), and the "new workflow" menu
 * (`WorkflowMainNewMenu`) so this file stays the orchestrator: it owns the
 * list query, the run-record fetch a Run click needs, the delete mutation,
 * and nothing about how any one piece paints.
 */
export function WorkflowsMainSurface({
  authCacheScope,
  onEdit,
  onNew,
}: WorkflowsMainSurfaceProps) {
  const listQuery = useWorkflowDefinitionsV2ListAccess(authCacheScope);
  const { deleteWorkflowDefinitionV2, deletingWorkflowDefinitionV2 } =
    useWorkflowDefinitionV2MutationsAccess(authCacheScope);
  const { selectWorkspaceFromSurface } = useWorkspaceNavigationWorkflow();
  const executions = useWorkflowExecutions();

  const [filterText, setFilterText] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);
  const runQuery = useWorkflowDefinitionV2Access(runningId, authCacheScope, runningId !== null);

  const [deleteTarget, setDeleteTarget] = useState<WorkflowMainListItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleRun = (id: string) => {
    if (id === runningId) {
      if (runQuery.isError) {
        void runQuery.refetch();
      }
      return;
    }
    setRunningId(id);
  };

  const handleLaunched = (launch: WorkflowTriggerLaunch) => {
    setRunningId(null);
    selectWorkspaceFromSurface(launch.workspaceId, "workflows-main-surface", {
      knownWorkspace: launch.workspace,
    });
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) {
      return;
    }
    setDeleteError(null);
    void deleteWorkflowDefinitionV2({
      workflowDefinitionId: deleteTarget.id,
      expectedRevision: deleteTarget.revision,
    })
      .then(() => setDeleteTarget(null))
      .catch(() => setDeleteError(WORKFLOW_MAIN_COPY.deleteErrorMessage));
  };

  if (listQuery.isLoading) {
    return (
      <ProductPageShell title={WORKFLOW_MAIN_COPY.pageTitle} maxWidthClassName="max-w-5xl" telemetryBlocked>
        <p className="py-6 text-body text-muted-foreground" role="status">
          {WORKFLOW_MAIN_COPY.loadingTitle}
        </p>
      </ProductPageShell>
    );
  }

  if (listQuery.isError) {
    return (
      <ProductPageShell title={WORKFLOW_MAIN_COPY.pageTitle} maxWidthClassName="max-w-5xl" telemetryBlocked>
        <EmptyState
          title={WORKFLOW_MAIN_COPY.errorTitle}
          description={WORKFLOW_MAIN_COPY.errorDescription}
          action={(
            <Button type="button" variant="secondary" size="sm" onClick={() => void listQuery.refetch()}>
              <RotateCcw className="icon-paired" aria-hidden />
              {WORKFLOW_MAIN_COPY.retryLabel}
            </Button>
          )}
        />
      </ProductPageShell>
    );
  }

  const rows = listQuery.data?.workflows ?? [];
  const items = selectWorkflowV2DefinitionRows(rows);
  const runningRecord: WorkflowDefinitionRecordV2 | undefined =
    runningId !== null && runQuery.data?.id === runningId ? runQuery.data : undefined;

  // One filter over every group, the way the design's index reads: a group a
  // query empties simply drops out. The needle is plain substring matching on
  // what the rows visibly say — title/description for definitions, the
  // resolved title for executions — never on hidden identifiers.
  const needle = filterText.trim().toLowerCase();
  const matches = (...haystacks: (string | null)[]) =>
    needle.length === 0
    || haystacks.some((value) => value !== null && value.toLowerCase().includes(needle));
  const visibleItems = items.filter((item) => matches(item.title, item.description));
  const visibleRuns = executions.runs.filter((run) => matches(
    workflowRunDefinitionTitle(run.definitionJson) ?? WORKFLOW_MAIN_COPY.executionFallbackTitle,
  ));
  const filterable = items.length + executions.runs.length > 0;
  const nothingMatches = needle.length > 0
    && filterable
    && visibleItems.length + visibleRuns.length === 0;

  return (
    <ProductPageShell
      title={WORKFLOW_MAIN_COPY.pageTitle}
      description={WORKFLOW_MAIN_COPY.pageDescription}
      actions={<WorkflowMainNewMenu onNew={onNew} />}
      maxWidthClassName="max-w-5xl"
      telemetryBlocked
    >
      {filterable ? (
        // The same filter-row recipe `HarnessAllModelsSection` composes from
        // `PopoverSearchField`'s anatomy: leading Search glyph, borderless
        // Input, hairline underneath.
        <div className="flex items-center gap-2 border-b border-border px-2.5 py-[7px]">
          <Search className="icon-paired shrink-0 text-muted-foreground/75" />
          <Input
            variant="unstyled"
            aria-label={WORKFLOW_MAIN_COPY.filterLabel}
            placeholder={WORKFLOW_MAIN_COPY.filterPlaceholder}
            value={filterText}
            className="h-auto min-w-0 flex-1 px-0 py-0 text-ui"
            onChange={(event) => setFilterText(event.target.value)}
          />
        </div>
      ) : null}

      {items.length === 0 ? (
        <WorkflowMainEmptyState onNew={onNew} />
      ) : visibleItems.length > 0 ? (
        <Card
          surface="opaque"
          as="section"
          className="flex flex-col gap-0.5 p-2"
          header={(
            <div className="flex flex-col gap-0.5 px-3 py-2">
              <h2 className="text-ui font-medium text-foreground">
                {WORKFLOW_MAIN_COPY.savedGroupTitle}
              </h2>
              <p className="text-ui-sm text-muted-foreground">
                {WORKFLOW_MAIN_COPY.savedGroupDescription}
              </p>
            </div>
          )}
        >
          {visibleItems.map((item) => (
            <WorkflowMainDefinitionRow
              key={item.id}
              item={item}
              running={runningId === item.id && runQuery.isLoading}
              onRun={() => handleRun(item.id)}
              onEdit={() => onEdit(item.id)}
              onDelete={() => {
                setDeleteError(null);
                setDeleteTarget(item);
              }}
            />
          ))}
        </Card>
      ) : null}

      {visibleRuns.length > 0 ? (
        <WorkflowMainExecutionsGroup
          runs={visibleRuns}
          onOpen={(run) => selectWorkspaceFromSurface(run.workspaceId, "workflows-main-surface")}
        />
      ) : null}

      {nothingMatches ? (
        <p className="px-1 text-ui-sm text-muted-foreground" role="status">
          {WORKFLOW_MAIN_COPY.filterNoMatches(filterText.trim())}
        </p>
      ) : null}

      {runningRecord ? (
        <WorkflowTriggerDialog
          definitionRecord={runningRecord}
          open
          onOpenChange={(open) => {
            if (!open) {
              setRunningId(null);
            }
          }}
          onLaunched={handleLaunched}
          authCacheScope={authCacheScope}
        />
      ) : null}

      <WorkflowMainDeleteDialog
        open={deleteTarget !== null}
        title={deleteTarget?.title ?? ""}
        deleting={deletingWorkflowDefinitionV2}
        error={deleteError}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />
    </ProductPageShell>
  );
}
