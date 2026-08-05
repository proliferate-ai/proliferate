import type { WorkflowDefinitionResponse } from "@proliferate/cloud-sdk";
import {
  isWorkflowRevisionConflict,
  workflowDefinitionFromResponse,
  workflowWriteErrorMessage,
  type WorkflowDefinition,
} from "@proliferate/product-domain/workflows/definition";

export interface WorkflowRepositoryOptionModel {
  id: string;
  label: string;
}

export function workflowDefinitionModel(
  response: WorkflowDefinitionResponse,
): WorkflowDefinition {
  return workflowDefinitionFromResponse(response);
}

export function workflowDefinitionModels(
  responses: readonly WorkflowDefinitionResponse[],
): WorkflowDefinition[] {
  return responses.map(workflowDefinitionFromResponse);
}

export function workflowRepositoryOptions(
  repositories: ReadonlyArray<{
    id: string;
    gitOwner: string;
    gitRepoName: string;
  }>,
): WorkflowRepositoryOptionModel[] {
  return repositories.map((repository) => ({
    id: repository.id,
    label: `${repository.gitOwner}/${repository.gitRepoName}`,
  }));
}

export function workflowDefinitionAuthoringWarning({
  newerRevisionAvailable,
  hasWriteFailure,
  definitionRefreshFailed,
  validatedCatalogVersion,
  catalogVersion,
  catalogError,
}: {
  newerRevisionAvailable: boolean;
  hasWriteFailure: boolean;
  definitionRefreshFailed: boolean;
  validatedCatalogVersion: string;
  catalogVersion: string;
  catalogError: boolean;
}): string | null {
  if (newerRevisionAvailable && !hasWriteFailure) {
    return "A newer revision of this workflow is available. Reload to edit the latest version.";
  }
  if (definitionRefreshFailed) {
    return "The workflow could not be refreshed; editing continues on the loaded version.";
  }
  if (validatedCatalogVersion !== catalogVersion) {
    return `This workflow was validated with catalog ${validatedCatalogVersion}. Saving will validate it against ${catalogVersion}.`;
  }
  if (catalogError) {
    return "Catalog refresh failed; editing uses the last loaded catalog.";
  }
  return null;
}

export function workflowCreateAuthoringWarning({
  catalogError,
  repositoriesError,
}: {
  catalogError: boolean;
  repositoriesError: boolean;
}): string | null {
  if (catalogError) {
    return "Catalog refresh failed; editing uses the last loaded catalog.";
  }
  if (repositoriesError) {
    return "Repositories could not be loaded. You can still save with no repository.";
  }
  return null;
}

export function workflowDefinitionWriteFailureMessage(error: unknown): string {
  return workflowWriteErrorMessage(error);
}

export function isWorkflowDefinitionRevisionConflict(error: unknown): boolean {
  return isWorkflowRevisionConflict(error);
}
