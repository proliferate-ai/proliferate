import { useMemo, useState } from "react";
import {
  useCloudAgentCatalog,
  useRepositories,
  useWorkflowDefinition,
  useWorkflowDefinitionActions,
  useWorkflowDefinitions,
} from "@proliferate/cloud-sdk-react";
import {
  ProliferateClientError,
  type WorkflowDefinitionCreateRequest,
  type WorkflowDefinitionResponse,
  type WorkflowDefinitionUpdateRequest,
} from "@proliferate/cloud-sdk";
import {
  createWorkflowDefinitionDraft,
  validateWorkflowDefinitionDraft,
  workflowDefinitionToDraft,
  workflowDraftToWriteInput,
  type WorkflowAgentCatalog,
  type WorkflowDefinition,
  type WorkflowDefinitionDraft,
} from "@proliferate/product-domain/workflows/definition";
import {
  WorkflowDefinitionEditor,
  type WorkflowRepositoryOption,
} from "@proliferate/product-ui/workflows/WorkflowDefinitionEditor";
import { WorkflowDefinitionList } from "@proliferate/product-ui/workflows/WorkflowDefinitionList";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { Button } from "@proliferate/ui/primitives/Button";
import { ProductPageShell } from "@proliferate/product-ui/layout/ProductPageShell";

export interface WorkflowDefinitionsSurfaceProps {
  authCacheScope: string;
  selectedWorkflowId?: string | null;
  onSelectWorkflow: (workflowId: string) => void;
  onBackToList: () => void;
}

export function WorkflowDefinitionsSurface({
  authCacheScope,
  selectedWorkflowId = null,
  onSelectWorkflow,
  onBackToList,
}: WorkflowDefinitionsSurfaceProps) {
  const [creating, setCreating] = useState(false);
  const definitionsQuery = useWorkflowDefinitions(
    authCacheScope,
    selectedWorkflowId === null && !creating,
  );
  const catalogQuery = useCloudAgentCatalog();
  const repositoriesQuery = useRepositories(true, authCacheScope);
  const catalog = catalogQuery.data as WorkflowAgentCatalog | undefined;
  const repositories = useMemo(
    () => repositoryOptions(repositoriesQuery.data?.repositories ?? []),
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
        key={catalog.catalogVersion}
        catalog={catalog}
        catalogError={catalogQuery.isError}
        authCacheScope={authCacheScope}
        repositories={repositories}
        repositoriesLoading={repositoriesQuery.isLoading}
        repositoriesError={repositoriesQuery.isError}
        onCreated={onSelectWorkflow}
        onCancel={() => setCreating(false)}
      />
    );
  }

  const definitions = (definitionsQuery.data?.workflows ?? []).map(toWorkflowDefinition);
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
  const [draft, setDraft] = useState(() => createWorkflowDefinitionDraft(catalog));
  const [showValidation, setShowValidation] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const actions = useWorkflowDefinitionActions(authCacheScope);
  const issues = showValidation ? validateWorkflowDefinitionDraft(draft, catalog) : [];

  const save = async () => {
    setShowValidation(true);
    const nextIssues = validateWorkflowDefinitionDraft(draft, catalog);
    if (nextIssues.length > 0) {
      return;
    }
    setServerError(null);
    try {
      const created = await actions.createWorkflowDefinition(toCreateRequest(draft, catalog));
      onCreated(created.id);
    } catch (error) {
      setServerError(workflowWriteError(error));
    }
  };

  return (
    <WorkflowDefinitionEditor
      mode="create"
      draft={draft}
      catalog={catalog}
      repositories={repositories}
      issues={issues}
      serverError={serverError}
      catalogWarning={
        catalogError
          ? "Catalog refresh failed; editing uses the last loaded catalog."
          : repositoriesError
            ? "Repositories could not be loaded. You can still save with no repository."
            : null
      }
      saving={actions.creatingWorkflowDefinition}
      loadingRepositories={repositoriesLoading}
      onChange={setDraft}
      onSave={() => void save()}
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
}) {
  const definitionQuery = useWorkflowDefinition(workflowId, authCacheScope);

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
  if (definitionQuery.isError || !definitionQuery.data) {
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

  const definition = toWorkflowDefinition(definitionQuery.data);
  return (
    <PersistedWorkflowEditor
      authCacheScope={authCacheScope}
      key={`${definition.id}:${definition.revision}`}
      definition={definition}
      catalog={catalog}
      catalogError={catalogError}
      repositories={repositories}
      repositoriesLoading={repositoriesLoading}
      onSaved={onSaved}
      onBack={onBack}
    />
  );
}

function PersistedWorkflowEditor({
  authCacheScope,
  definition,
  catalog,
  catalogError,
  repositories,
  repositoriesLoading,
  onSaved,
  onBack,
}: {
  authCacheScope: string;
  definition: WorkflowDefinition;
  catalog: WorkflowAgentCatalog;
  catalogError: boolean;
  repositories: readonly WorkflowRepositoryOption[];
  repositoriesLoading: boolean;
  onSaved: (workflowId: string) => void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState(() => workflowDefinitionToDraft(definition));
  const [showValidation, setShowValidation] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const actions = useWorkflowDefinitionActions(authCacheScope);
  const issues = showValidation ? validateWorkflowDefinitionDraft(draft, catalog) : [];

  const save = async () => {
    setShowValidation(true);
    const nextIssues = validateWorkflowDefinitionDraft(draft, catalog);
    if (nextIssues.length > 0) {
      return;
    }
    setServerError(null);
    try {
      const updated = await actions.updateWorkflowDefinition({
        workflowDefinitionId: definition.id,
        body: toUpdateRequest(draft, definition.revision, catalog),
      });
      onSaved(updated.id);
    } catch (error) {
      setServerError(workflowWriteError(error));
    }
  };

  const remove = async () => {
    setServerError(null);
    try {
      await actions.deleteWorkflowDefinition({
        workflowDefinitionId: definition.id,
        expectedRevision: definition.revision,
      });
      onBack();
    } catch (error) {
      setServerError(workflowWriteError(error));
    }
  };

  const versionWarning = definition.validatedCatalogVersion !== catalog.catalogVersion
    ? `This workflow was validated with catalog ${definition.validatedCatalogVersion}. Saving will validate it against ${catalog.catalogVersion}.`
    : catalogError
      ? "Catalog refresh failed; editing uses the last loaded catalog."
      : null;

  return (
    <WorkflowDefinitionEditor
      mode="edit"
      draft={draft}
      catalog={catalog}
      repositories={repositories}
      issues={issues}
      serverError={serverError}
      catalogWarning={versionWarning}
      saving={actions.updatingWorkflowDefinition}
      deleting={actions.deletingWorkflowDefinition}
      loadingRepositories={repositoriesLoading}
      onChange={setDraft}
      onSave={() => void save()}
      onCancel={onBack}
      onDelete={() => void remove()}
    />
  );
}

function WorkflowResourceState({
  loading = false,
  title,
  description,
  onBack,
  onRetry,
}: {
  loading?: boolean;
  title: string;
  description: string;
  onBack: () => void;
  onRetry?: () => void;
}) {
  return (
    <ProductPageShell
      title="Workflows"
      actions={<Button type="button" variant="ghost" onClick={onBack}>Back</Button>}
      maxWidthClassName="max-w-5xl"
      telemetryBlocked
    >
      {loading ? (
        <p className="py-6 text-sm text-muted-foreground" role="status">{title}</p>
      ) : (
        <EmptyState
          title={title}
          description={description}
          action={onRetry ? (
            <Button type="button" variant="secondary" onClick={onRetry}>Retry</Button>
          ) : null}
        />
      )}
    </ProductPageShell>
  );
}

function repositoryOptions(
  repositories: ReadonlyArray<{
    id: string;
    gitOwner: string;
    gitRepoName: string;
  }>,
): WorkflowRepositoryOption[] {
  return repositories.map((repository) => ({
    id: repository.id,
    label: `${repository.gitOwner}/${repository.gitRepoName}`,
  }));
}

function toWorkflowDefinition(response: WorkflowDefinitionResponse): WorkflowDefinition {
  return {
    id: response.id,
    userId: response.userId,
    title: response.title,
    description: response.description,
    schemaVersion: 1,
    revision: response.revision,
    validatedCatalogVersion: response.validatedCatalogVersion,
    defaultRepoConfigId: response.defaultRepoConfigId,
    inputs: (response.inputs ?? []).map((input) => ({ ...input })),
    stages: response.stages.map((stage) => ({
      harnessConfig: { ...stage.harnessConfig },
      steps: stage.steps.map((step) => ({
        kind: "agent.prompt",
        prompt: step.prompt,
        goal: step.goal ? { objective: step.goal.objective } : null,
      })),
    })),
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
    deletedAt: null,
  };
}

function toCreateRequest(
  draft: WorkflowDefinitionDraft,
  catalog: WorkflowAgentCatalog,
): WorkflowDefinitionCreateRequest {
  return workflowDraftToWriteInput(draft, catalog);
}

function toUpdateRequest(
  draft: WorkflowDefinitionDraft,
  expectedRevision: number,
  catalog: WorkflowAgentCatalog,
): WorkflowDefinitionUpdateRequest {
  return {
    ...workflowDraftToWriteInput(draft, catalog),
    expectedRevision,
  };
}

function workflowWriteError(error: unknown): string {
  if (error instanceof ProliferateClientError && error.status === 409) {
    return "This workflow changed in another window. Reload it and apply your changes again.";
  }
  return error instanceof Error ? error.message : "Workflow could not be saved.";
}
