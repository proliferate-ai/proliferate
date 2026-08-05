import type { ReactNode } from "react";
import {
  type WorkflowAgentCatalog,
  type WorkflowDefinition,
} from "@proliferate/product-domain/workflows/definition";
import {
  WorkflowDefinitionEditor,
  type WorkflowRepositoryOption,
} from "@proliferate/product-ui/workflows/WorkflowDefinitionEditor";
import {
  usePersistedWorkflowDefinitionActions,
  type WorkflowDefinitionRefetchResult,
} from "#product/hooks/workflows/workflows/use-workflow-definition-actions";

export function PersistedWorkflowEditor({
  authCacheScope,
  definition,
  catalog,
  catalogError,
  definitionRefreshFailed,
  repositories,
  repositoriesLoading,
  refetchDefinition,
  onSaved,
  onBack,
  supplementalContent,
}: {
  authCacheScope: string;
  definition: WorkflowDefinition;
  catalog: WorkflowAgentCatalog;
  catalogError: boolean;
  definitionRefreshFailed: boolean;
  repositories: readonly WorkflowRepositoryOption[];
  repositoriesLoading: boolean;
  refetchDefinition: () => Promise<WorkflowDefinitionRefetchResult>;
  onSaved: (workflowId: string) => void;
  onBack: () => void;
  supplementalContent?: ReactNode;
}) {
  const actions = usePersistedWorkflowDefinitionActions({
    authCacheScope,
    definition,
    catalog,
    catalogError,
    definitionRefreshFailed,
    refetchDefinition,
    onSaved,
    onBack,
  });

  return (
    <WorkflowDefinitionEditor
      mode="edit"
      draft={actions.draft}
      catalog={catalog}
      repositories={repositories}
      issues={actions.issues}
      serverError={actions.failureMessage}
      catalogWarning={actions.versionWarning}
      saving={actions.saving}
      deleting={actions.deleting}
      loadingRepositories={repositoriesLoading}
      onChange={actions.onChange}
      onSave={actions.onSave}
      onCancel={onBack}
      onDelete={actions.onDelete}
      onReload={actions.onReload}
      supplementalContent={supplementalContent}
    />
  );
}
