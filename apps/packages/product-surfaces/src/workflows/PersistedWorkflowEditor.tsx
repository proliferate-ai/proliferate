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
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  // Once a revision conflict is seen, the deliberate-reload affordance stays
  // available until a reload actually succeeds (adopt clears it) — a failed
  // reload attempt must not remove the only way out of the conflict.
  const [conflictPending, setConflictPending] = useState(false);
  const actions = useWorkflowDefinitionActions(authCacheScope);
  const issues = showValidation ? validateWorkflowDefinitionDraft(draft, catalog) : [];

  const recordWriteFailure = (error: unknown) => {
    setFailureMessage(workflowWriteErrorMessage(error));
    if (isWorkflowRevisionConflict(error)) {
      setConflictPending(true);
    }
  };

  const adopt = (next: WorkflowDefinition) => {
    setBase(next);
    setDraft(workflowDefinitionToDraft(next));
    setShowValidation(false);
    setFailureMessage(null);
    setConflictPending(false);
  };

  const reload = async () => {
    try {
      adopt(await reloadDefinition());
    } catch (error) {
      setFailureMessage(workflowWriteErrorMessage(error));
    }
  };

  const save = async () => {
    setShowValidation(true);
    const nextIssues = validateWorkflowDefinitionDraft(draft, catalog);
    if (nextIssues.length > 0) {
      return;
    }
    setFailureMessage(null);
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
    setFailureMessage(null);
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
  const showReload = newerRevisionAvailable || conflictPending;
  // One coherent reload affordance: when the error banner already carries the
  // Reload action, the warning ladder must not render a second one, so the
  // newer-revision hint collapses into the informational tier.
  const versionWarning = newerRevisionAvailable && failureMessage === null
    ? "A newer revision of this workflow is available. Reload to edit the latest version."
    : definitionRefreshFailed
      ? "The workflow could not be refreshed; editing continues on the loaded version."
      : base.validatedCatalogVersion !== catalog.catalogVersion
        ? `This workflow was validated with catalog ${base.validatedCatalogVersion}. Saving will validate it against ${catalog.catalogVersion}.`
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
      serverError={failureMessage}
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
