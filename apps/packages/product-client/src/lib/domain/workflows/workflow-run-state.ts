import type {
  ManagedWorkflowHistoryItem,
  ManagedWorkflowInvocationResponse,
} from "@proliferate/cloud-sdk";
import { safeWorkflowFailureCopy } from "@proliferate/product-domain/workflows/run-presentation";

export interface WorkflowCloudError {
  status: number;
  code: string | null;
}

export interface WorkflowRunOpenResult {
  opened: boolean;
  message?: string;
}

export function dedupeWorkflowRunHistory(
  data: { pages: ReadonlyArray<{ items: readonly ManagedWorkflowHistoryItem[] }> } | undefined,
): ManagedWorkflowHistoryItem[] {
  const unique = new Map<string, ManagedWorkflowHistoryItem>();
  for (const page of data?.pages ?? []) {
    for (const item of page.items) {
      if (!unique.has(item.id)) {
        unique.set(item.id, item);
      }
    }
  }
  return [...unique.values()];
}

export function projectWorkflowTargetLost(
  run: ManagedWorkflowInvocationResponse,
): ManagedWorkflowInvocationResponse {
  return {
    ...run,
    managedExecution: {
      ...run.managedExecution,
      freshness: { ...run.managedExecution.freshness, status: "target_lost" },
    },
  };
}

export function inspectWorkflowCloudError(error: unknown): WorkflowCloudError | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const status = "status" in error ? error.status : null;
  const code = "code" in error ? error.code : null;
  if (typeof status !== "number" || (code !== null && typeof code !== "string")) {
    return null;
  }
  return { status, code };
}

export function safeWorkflowActionError(error: unknown): string {
  if (
    error !== null
    && typeof error === "object"
    && "name" in error
    && error.name === "AbortError"
  ) {
    return "The request timed out. Its durable status may still have changed.";
  }
  const cloudError = inspectWorkflowCloudError(error);
  if (cloudError) {
    return safeWorkflowFailureCopy(cloudError.code)
      ?? "The workflow request could not be completed. Refresh for the latest status.";
  }
  return "The workflow request could not be completed. Refresh for the latest status.";
}
