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
  isWorkflowRevisionConflict,
  workflowDefinitionFromResponse,
  workflowDefinitionToDraft,
  workflowDraftToCreateRequest,
  workflowDraftToUpdateRequest,
  workflowWriteErrorMessage,
  type WorkflowAgentCatalog,
  type WorkflowDefinition,
} from "@proliferate/product-domain/workflows/definition";
import { validateWorkflowDefinitionDraft } from "@proliferate/product-domain/workflows/validation";
import {
  WorkflowDefinitionEditor,
  type WorkflowRepositoryOption,
} from "@proliferate/product-ui/workflows/WorkflowDefinitionEditor";
import { WorkflowDefinitionList } from "@proliferate/product-ui/workflows/WorkflowDefinitionList";
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

  const definition = workflowDefinitionFromResponse(definitionQuery.data);
  return (
    <PersistedWorkflowEditor
      authCacheScope={authCacheScope}
      key={definition.id}
      definition={definition}
      catalog={catalog}
      catalogError={catalogError}
      repositories={repositories}
      repositoriesLoading={repositoriesLoading}
      reloadDefinition={async () => {
        const result = await definitionQuery.refetch();
        return result.data ? workflowDefinitionFromResponse(result.data) : null;
      }}
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
  reloadDefinition,
  onSaved,
  onBack,
}: {
  authCacheScope: string;
  definition: WorkflowDefinition;
  catalog: WorkflowAgentCatalog;
  catalogError: boolean;
  repositories: readonly WorkflowRepositoryOption[];
  repositoriesLoading: boolean;
  reloadDefinition: () => Promise<WorkflowDefinition | null>;
  onSaved: (workflowId: string) => void;
  onBack: () => void;
}) {
  // The draft is seeded from `base`, not from the live query value: a passive
  // background refetch may bump `definition.revision` while the user is
  // editing, and the spec requires keeping the local draft until a deliberate
  // reload. Saves use the base revision so a stale editor still 409s.
  const [base, setBase] = useState(definition);
  const [draft, setDraft] = useState(() => workflowDefinitionToDraft(definition));
  const [showValidation, setShowValidation] = useState(false);
  const [writeFailure, setWriteFailure] = useState<
    { message: string; conflict: boolean } | null
  >(null);
  const actions = useWorkflowDefinitionActions(authCacheScope);
  const issues = showValidation ? validateWorkflowDefinitionDraft(draft, catalog) : [];

  const recordWriteFailure = (error: unknown) => {
    setWriteFailure({
      message: workflowWriteErrorMessage(error),
      conflict: isWorkflowRevisionConflict(error),
    });
  };

  const adopt = (next: WorkflowDefinition) => {
    setBase(next);
    setDraft(workflowDefinitionToDraft(next));
    setShowValidation(false);
    setWriteFailure(null);
  };

  const reload = async () => {
    try {
      const next = await reloadDefinition();
      if (next) {
        adopt(next);
      }
    } catch (error) {
      recordWriteFailure(error);
    }
  };

  const save = async () => {
    setShowValidation(true);
    const nextIssues = validateWorkflowDefinitionDraft(draft, catalog);
    if (nextIssues.length > 0) {
      return;
    }
    setWriteFailure(null);
    try {
      const updated = await actions.updateWorkflowDefinition({
        workflowDefinitionId: base.id,
        body: workflowDraftToUpdateRequest(draft, base.revision, catalog),
      });
      adopt(workflowDefinitionFromResponse(updated));
      onSaved(updated.id);
    } catch (error) {
      recordWriteFailure(error);
    }
  };

  const remove = async () => {
    setWriteFailure(null);
    try {
      await actions.deleteWorkflowDefinition({
        workflowDefinitionId: base.id,
        expectedRevision: base.revision,
      });
      onBack();
    } catch (error) {
      recordWriteFailure(error);
    }
  };

  const newerRevisionAvailable = definition.revision > base.revision;
  const versionWarning = newerRevisionAvailable
    ? "A newer revision of this workflow is available. Reload to edit the latest version."
    : base.validatedCatalogVersion !== catalog.catalogVersion
      ? `This workflow was validated with catalog ${base.validatedCatalogVersion}. Saving will validate it against ${catalog.catalogVersion}.`
      : catalogError
        ? "Catalog refresh failed; editing uses the last loaded catalog."
        : null;
  const showReload = newerRevisionAvailable || writeFailure?.conflict === true;

  return (
    <WorkflowDefinitionEditor
      mode="edit"
      draft={draft}
      catalog={catalog}
      repositories={repositories}
      issues={issues}
      serverError={writeFailure?.message ?? null}
      catalogWarning={versionWarning}
      saving={actions.updatingWorkflowDefinition}
      deleting={actions.deletingWorkflowDefinition}
      loadingRepositories={repositoriesLoading}
      onChange={setDraft}
      onSave={() => void save()}
      onCancel={onBack}
      onDelete={() => void remove()}
      onReload={showReload ? () => void reload() : undefined}
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
