import { useEffect, useMemo, useState } from "react";
import type { WorkflowAgentCatalog } from "@proliferate/product-domain/workflows/definition";
import {
  WorkflowDefinitionEditor,
  type WorkflowRepositoryOption,
} from "#product/components/workflows/WorkflowDefinitionEditor";
import { WorkflowDefinitionList } from "#product/components/workflows/WorkflowDefinitionList";
import {
  useWorkflowAuthoringResourcesAccess,
  useWorkflowDefinitionAccess,
  useWorkflowDefinitionsAccess,
} from "#product/hooks/access/cloud/workflows/use-workflow-definition-access";
import { useCreateWorkflowDefinitionActions } from "#product/hooks/workflows/workflows/use-workflow-definition-actions";
import {
  workflowCreateAuthoringWarning,
  workflowDefinitionModel,
  workflowDefinitionModels,
  workflowRepositoryOptions,
} from "#product/lib/domain/workflows/workflow-definition-authoring";
import { WorkflowResourceState } from "../WorkflowResourceState";
import { WorkflowDefinitionRunsPanel } from "../runs/WorkflowRunsSurface";
import { PersistedWorkflowEditor } from "./PersistedWorkflowEditor";

export interface WorkflowDefinitionsSurfaceProps {
  authCacheScope: string;
  selectedWorkflowId?: string | null;
  onSelectWorkflow: (workflowId: string) => void;
  onBackToList: () => void;
  managedRunsEnabled?: boolean;
  onOpenRun?: (workflowId: string, runId: string) => void;
}

export function WorkflowDefinitionsSurface({
  authCacheScope,
  selectedWorkflowId = null,
  onSelectWorkflow,
  onBackToList,
  managedRunsEnabled = false,
  onOpenRun = () => {},
}: WorkflowDefinitionsSurfaceProps) {
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (selectedWorkflowId) {
      setCreating(false);
    }
  }, [selectedWorkflowId]);
  const definitionsQuery = useWorkflowDefinitionsAccess(
    authCacheScope,
    selectedWorkflowId === null && !creating,
  );
  const { catalogQuery, repositoriesQuery } = useWorkflowAuthoringResourcesAccess(
    authCacheScope,
  );
  const catalog = catalogQuery.data as WorkflowAgentCatalog | undefined;
  const repositories = useMemo<WorkflowRepositoryOption[]>(
    () => workflowRepositoryOptions(repositoriesQuery.data?.repositories ?? []),
    [repositoriesQuery.data?.repositories],
  );

  if (selectedWorkflowId) {
    return (
      <ExistingWorkflowDefinitionEditor
        authCacheScope={authCacheScope}
        workflowId={selectedWorkflowId}
        catalog={catalog ?? null}
        catalogLoading={catalogQuery.isLoading}
        catalogError={catalogQuery.isError}
        repositories={repositories}
        repositoriesLoading={repositoriesQuery.isLoading}
        onSaved={onSelectWorkflow}
        onBack={onBackToList}
        managedRunsEnabled={managedRunsEnabled}
        onOpenRun={(runId) => onOpenRun(selectedWorkflowId, runId)}
      />
    );
  }

  if (creating) {
    if (!catalog) {
      return (
        <WorkflowResourceState
          loading={catalogQuery.isLoading}
          title="Agent catalog unavailable"
          description="Workflow harnesses and model options could not be loaded."
          onBack={() => setCreating(false)}
          onRetry={() => void catalogQuery.refetch()}
        />
      );
    }
    return (
      <CreateWorkflowDefinitionEditor
        catalog={catalog}
        catalogError={catalogQuery.isError}
        authCacheScope={authCacheScope}
        repositories={repositories}
        repositoriesLoading={repositoriesQuery.isLoading}
        repositoriesError={repositoriesQuery.isError}
        onCreated={(workflowId) => {
          setCreating(false);
          onSelectWorkflow(workflowId);
        }}
        onCancel={() => setCreating(false)}
      />
    );
  }

  const definitions = workflowDefinitionModels(definitionsQuery.data?.workflows ?? []);
  const catalogFailedWithoutData = catalogQuery.isError && !catalog;
  return (
    <WorkflowDefinitionList
      definitions={definitions}
      loading={definitionsQuery.isLoading || catalogQuery.isLoading}
      error={
        definitionsQuery.isError
          ? "Refresh the page or sign in again."
          : catalogFailedWithoutData
            ? "The live agent catalog could not be loaded."
            : null
      }
      onNew={() => setCreating(true)}
      onSelect={onSelectWorkflow}
      onRetry={() => {
        void definitionsQuery.refetch();
        void catalogQuery.refetch();
      }}
    />
  );
}

function CreateWorkflowDefinitionEditor({
  authCacheScope,
  catalog,
  catalogError,
  repositories,
  repositoriesLoading,
  repositoriesError,
  onCreated,
  onCancel,
}: {
  authCacheScope: string;
  catalog: WorkflowAgentCatalog;
  catalogError: boolean;
  repositories: readonly WorkflowRepositoryOption[];
  repositoriesLoading: boolean;
  repositoriesError: boolean;
  onCreated: (workflowId: string) => void;
  onCancel: () => void;
}) {
  const actions = useCreateWorkflowDefinitionActions({
    authCacheScope,
    catalog,
    onCreated,
  });

  return (
    <WorkflowDefinitionEditor
      mode="create"
      draft={actions.draft}
      catalog={catalog}
      repositories={repositories}
      issues={actions.issues}
      serverError={actions.serverError}
      catalogWarning={workflowCreateAuthoringWarning({
        catalogError,
        repositoriesError,
      })}
      saving={actions.saving}
      loadingRepositories={repositoriesLoading}
      onChange={actions.onChange}
      onSave={actions.onSave}
      onCancel={onCancel}
    />
  );
}

function ExistingWorkflowDefinitionEditor({
  authCacheScope,
  workflowId,
  catalog,
  catalogLoading,
  catalogError,
  repositories,
  repositoriesLoading,
  onSaved,
  onBack,
  managedRunsEnabled,
  onOpenRun,
}: {
  authCacheScope: string;
  workflowId: string;
  catalog: WorkflowAgentCatalog | null;
  catalogLoading: boolean;
  catalogError: boolean;
  repositories: readonly WorkflowRepositoryOption[];
  repositoriesLoading: boolean;
  onSaved: (workflowId: string) => void;
  onBack: () => void;
  managedRunsEnabled: boolean;
  onOpenRun: (runId: string) => void;
}) {
  const definitionQuery = useWorkflowDefinitionAccess(workflowId, authCacheScope);

  if (definitionQuery.isLoading || catalogLoading) {
    return (
      <WorkflowResourceState
        loading
        title="Loading workflow"
        description="Loading the definition and current agent catalog."
        onBack={onBack}
      />
    );
  }
  // A failed passive refetch reports isError while cached data remains; only
  // a missing definition is fatal. The mounted editor keeps its local draft.
  if (!definitionQuery.data) {
    return (
      <WorkflowResourceState
        title="Workflow not found"
        description="It may have been deleted or you may not have access."
        onBack={onBack}
        onRetry={() => void definitionQuery.refetch()}
      />
    );
  }
  if (!catalog) {
    return (
      <WorkflowResourceState
        title="Agent catalog unavailable"
        description="The definition is safe, but it cannot be edited without current catalog validation."
        onBack={onBack}
      />
    );
  }

  const definition = workflowDefinitionModel(definitionQuery.data);
  return (
    <PersistedWorkflowEditor
      authCacheScope={authCacheScope}
      key={definition.id}
      definition={definition}
      catalog={catalog}
      catalogError={catalogError}
      definitionRefreshFailed={definitionQuery.isError}
      repositories={repositories}
      repositoriesLoading={repositoriesLoading}
      refetchDefinition={definitionQuery.refetch}
      onSaved={onSaved}
      onBack={onBack}
      supplementalContent={(
        <WorkflowDefinitionRunsPanel
          authCacheScope={authCacheScope}
          definition={definition}
          managedRunsEnabled={managedRunsEnabled}
          onOpenRun={onOpenRun}
        />
      )}
    />
  );
}
