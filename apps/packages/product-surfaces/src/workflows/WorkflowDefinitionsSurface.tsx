import { useEffect, useMemo, useState } from "react";
import {
  useCloudAgentCatalog,
  useRepositories,
  useWorkflowDefinition,
  useWorkflowDefinitionActions,
  useWorkflowDefinitions,
} from "@proliferate/cloud-sdk-react";
import {
  createWorkflowDefinitionDraft,
  workflowDefinitionFromResponse,
  workflowDraftToCreateRequest,
  workflowWriteErrorMessage,
  type WorkflowAgentCatalog,
} from "@proliferate/product-domain/workflows/definition";
import { validateWorkflowDefinitionDraft } from "@proliferate/product-domain/workflows/validation";
import {
  WorkflowDefinitionEditor,
  type WorkflowRepositoryOption,
} from "@proliferate/product-ui/workflows/WorkflowDefinitionEditor";
import { WorkflowDefinitionList } from "@proliferate/product-ui/workflows/WorkflowDefinitionList";
import { PersistedWorkflowEditor } from "./PersistedWorkflowEditor";
import { WorkflowResourceState } from "./WorkflowResourceState";

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
  useEffect(() => {
    if (selectedWorkflowId) {
      setCreating(false);
    }
  }, [selectedWorkflowId]);
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

  const definitions = (definitionsQuery.data?.workflows ?? []).map(workflowDefinitionFromResponse);
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
      const created = await actions.createWorkflowDefinition(
        workflowDraftToCreateRequest(draft, catalog),
      );
      onCreated(created.id);
    } catch (error) {
      setServerError(workflowWriteErrorMessage(error));
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
  // A failed passive refetch reports isError while cached data remains; only
  // a missing definition is fatal, otherwise the mounted editor (and any
  // unsaved draft) must survive the background failure.
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

  const definition = workflowDefinitionFromResponse(definitionQuery.data);
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
      reloadDefinition={async () => {
        // A failed refetch still resolves with the stale cached data; treat
        // it as a failure instead of adopting the old value into the draft.
        const result = await definitionQuery.refetch();
        if (result.isError || !result.data) {
          throw result.error ?? new Error("Workflow could not be reloaded.");
        }
        return workflowDefinitionFromResponse(result.data);
      }}
      onSaved={onSaved}
      onBack={onBack}
    />
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
