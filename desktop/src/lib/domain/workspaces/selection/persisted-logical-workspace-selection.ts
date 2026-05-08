import { isPendingWorkspaceUiKey } from "@/lib/domain/workspaces/creation/pending-entry";

export function normalizePersistedLogicalWorkspaceSelection(
  value: string | null | undefined,
): string | null {
  if (!value || isPendingWorkspaceUiKey(value)) {
    return null;
  }
  return value;
}

export function isPersistableLogicalWorkspaceSelection(
  value: string | null | undefined,
): value is string | null {
  return value === null || (typeof value === "string" && !isPendingWorkspaceUiKey(value));
}
