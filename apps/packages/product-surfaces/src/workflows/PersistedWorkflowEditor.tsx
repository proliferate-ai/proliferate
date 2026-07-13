import { useState } from "react";
import { useWorkflowDefinitionActions } from "@proliferate/cloud-sdk-react";
import {
  isWorkflowRevisionConflict,
  workflowDefinitionFromResponse,
  workflowDefinitionToDraft,
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

export function PersistedWorkflowEditor({
  authCacheScope,
  definition,
  catalog,
  catalogError,
  definitionRefreshFailed,
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
  definitionRefreshFailed: boolean;
  repositories: readonly WorkflowRepositoryOption[];
  repositoriesLoading: boolean;
  reloadDefinition: () => Promise<WorkflowDefinition>;
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
      adopt(await reloadDefinition());
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
    : definitionRefreshFailed
      ? "The workflow could not be refreshed; editing continues on the loaded version."
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
