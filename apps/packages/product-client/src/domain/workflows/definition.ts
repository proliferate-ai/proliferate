/**
 * Shared workflow write-failure classification and messaging. The gen-1
 * (schema_version 1) definition mapping that used to live here died with the
 * gen-1 lane; see `definition-v2.ts` for the gen-2 document model.
 */

export function isWorkflowRevisionConflict(error: unknown): boolean {
  return error instanceof Error && (error as { status?: unknown }).status === 409;
}

export function workflowWriteErrorMessage(error: unknown): string {
  if (isWorkflowRevisionConflict(error)) {
    return "This workflow changed in another window. Reload it and apply your changes again.";
  }
  return error instanceof Error ? error.message : "Workflow could not be saved.";
}
