import { useCallback, useState } from "react";
import type { WorkflowDefinitionAnyResponse } from "@proliferate/cloud-sdk";
import {
  createWorkflowDefinitionDraft,
  workflowDefinitionToDraft,
  workflowDraftToCreateRequest,
  workflowDraftToUpdateRequest,
  type WorkflowAgentCatalog,
  type WorkflowDefinition,
} from "#product/domain/workflows/definition";
import { validateWorkflowDefinitionDraft } from "#product/domain/workflows/validation";
import { useWorkflowDefinitionMutationsAccess } from "#product/hooks/access/cloud/workflows/use-workflow-definition-access";
import {
  isWorkflowDefinitionRevisionConflict,
  workflowDefinitionAuthoringWarning,
  workflowDefinitionModel,
  workflowDefinitionWriteFailureMessage,
} from "#product/lib/domain/workflows/workflow-definition-authoring";

export function useCreateWorkflowDefinitionActions({
  authCacheScope,
  catalog,
  onCreated,
}: {
  authCacheScope: string;
  catalog: WorkflowAgentCatalog;
  onCreated: (workflowId: string) => void;
}) {
  const [draft, setDraft] = useState(() => createWorkflowDefinitionDraft(catalog));
  const [showValidation, setShowValidation] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const access = useWorkflowDefinitionMutationsAccess(authCacheScope);
  const issues = showValidation ? validateWorkflowDefinitionDraft(draft, catalog) : [];

  const save = useCallback(async () => {
    setShowValidation(true);
    const nextIssues = validateWorkflowDefinitionDraft(draft, catalog);
    if (nextIssues.length > 0) {
      return;
    }
    setServerError(null);
    try {
      const created = await access.createWorkflowDefinition(
        workflowDraftToCreateRequest(draft, catalog),
      );
      onCreated(created.id);
    } catch (error) {
      setServerError(workflowDefinitionWriteFailureMessage(error));
    }
  }, [access, catalog, draft, onCreated]);

  return {
    draft,
    issues,
    serverError,
    saving: access.creatingWorkflowDefinition,
    onChange: setDraft,
    onSave: () => {
      void save();
    },
  };
}

export interface WorkflowDefinitionRefetchResult {
  data?: WorkflowDefinitionAnyResponse;
  error?: unknown;
  isError: boolean;
}

export function usePersistedWorkflowDefinitionActions({
  authCacheScope,
  definition,
  catalog,
  catalogError,
  definitionRefreshFailed,
  refetchDefinition,
  onSaved,
  onBack,
}: {
  authCacheScope: string;
  definition: WorkflowDefinition;
  catalog: WorkflowAgentCatalog;
  catalogError: boolean;
  definitionRefreshFailed: boolean;
  refetchDefinition: () => Promise<WorkflowDefinitionRefetchResult>;
  onSaved: (workflowId: string) => void;
  onBack: () => void;
}) {
  // The draft is seeded from `base`, not from the live query value: a passive
  // background refetch may bump the revision while the user is editing.
  const [base, setBase] = useState(definition);
  const [draft, setDraft] = useState(() => workflowDefinitionToDraft(definition));
  const [showValidation, setShowValidation] = useState(false);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [conflictPending, setConflictPending] = useState(false);
  const access = useWorkflowDefinitionMutationsAccess(authCacheScope);
  const issues = showValidation ? validateWorkflowDefinitionDraft(draft, catalog) : [];

  const recordWriteFailure = useCallback((error: unknown) => {
    setFailureMessage(workflowDefinitionWriteFailureMessage(error));
    if (isWorkflowDefinitionRevisionConflict(error)) {
      setConflictPending(true);
    }
  }, []);

  const adopt = useCallback((next: WorkflowDefinition) => {
    setBase(next);
    setDraft(workflowDefinitionToDraft(next));
    setShowValidation(false);
    setFailureMessage(null);
    setConflictPending(false);
  }, []);

  const reload = useCallback(async () => {
    try {
      const result = await refetchDefinition();
      if (result.isError || !result.data) {
        throw result.error ?? new Error("Workflow could not be reloaded.");
      }
      const next = workflowDefinitionModel(result.data);
      if (!next) {
        throw new Error("This workflow was saved by a newer builder and cannot be edited here.");
      }
      adopt(next);
    } catch (error) {
      setFailureMessage(workflowDefinitionWriteFailureMessage(error));
    }
  }, [adopt, refetchDefinition]);

  const save = useCallback(async () => {
    setShowValidation(true);
    const nextIssues = validateWorkflowDefinitionDraft(draft, catalog);
    if (nextIssues.length > 0) {
      return;
    }
    setFailureMessage(null);
    try {
      const updated = await access.updateWorkflowDefinition({
        workflowDefinitionId: base.id,
        body: workflowDraftToUpdateRequest(draft, base.revision, catalog),
      });
      const saved = workflowDefinitionModel(updated);
      if (saved) {
        adopt(saved);
      }
      onSaved(updated.id);
    } catch (error) {
      recordWriteFailure(error);
    }
  }, [access, adopt, base.id, base.revision, catalog, draft, onSaved, recordWriteFailure]);

  const remove = useCallback(async () => {
    setFailureMessage(null);
    try {
      await access.deleteWorkflowDefinition({
        workflowDefinitionId: base.id,
        expectedRevision: base.revision,
      });
      onBack();
    } catch (error) {
      recordWriteFailure(error);
    }
  }, [access, base.id, base.revision, onBack, recordWriteFailure]);

  const newerRevisionAvailable = definition.revision > base.revision;
  const showReload = newerRevisionAvailable || conflictPending;
  const versionWarning = workflowDefinitionAuthoringWarning({
    newerRevisionAvailable,
    hasWriteFailure: failureMessage !== null,
    definitionRefreshFailed,
    validatedCatalogVersion: base.validatedCatalogVersion,
    catalogVersion: catalog.catalogVersion,
    catalogError,
  });

  return {
    draft,
    issues,
    failureMessage,
    versionWarning,
    saving: access.updatingWorkflowDefinition,
    deleting: access.deletingWorkflowDefinition,
    onChange: setDraft,
    onSave: () => {
      void save();
    },
    onDelete: () => {
      void remove();
    },
    onReload: showReload
      ? () => {
          void reload();
        }
      : undefined,
  };
}
