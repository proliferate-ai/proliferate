// Workflows gen-2 run query keys, in their own module so the shared
// query-keys.ts stays under its size threshold. Same scope conventions:
// everything nests under anyHarnessRuntimeKey so runtime-wide invalidation
// still reaches these caches.

import { anyHarnessRuntimeKey } from "./query-keys.js";

export function anyHarnessWorkflowRunsScopeKey(
  runtimeUrl: string | null | undefined,
  cacheScopeKey: string | null | undefined,
) {
  return [...anyHarnessRuntimeKey(runtimeUrl, cacheScopeKey), "workflow-runs"] as const;
}

export function anyHarnessWorkflowRunsListScopeKey(
  runtimeUrl: string | null | undefined,
  cacheScopeKey: string | null | undefined,
) {
  return [...anyHarnessWorkflowRunsScopeKey(runtimeUrl, cacheScopeKey), "list"] as const;
}

export function anyHarnessWorkflowRunsListKey(
  runtimeUrl: string | null | undefined,
  cacheScopeKey: string | null | undefined,
  workspaceId?: string | null,
) {
  return [
    ...anyHarnessWorkflowRunsListScopeKey(runtimeUrl, cacheScopeKey),
    workspaceId ?? null,
  ] as const;
}

export function anyHarnessWorkflowRunKey(
  runtimeUrl: string | null | undefined,
  cacheScopeKey: string | null | undefined,
  runId: string | null | undefined,
) {
  return [
    ...anyHarnessWorkflowRunsScopeKey(runtimeUrl, cacheScopeKey),
    "run",
    runId ?? null,
  ] as const;
}
