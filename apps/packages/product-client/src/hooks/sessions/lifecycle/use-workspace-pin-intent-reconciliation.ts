import { useCallback, useEffect, useRef } from "react";
import { useLogicalWorkspaces } from "#product/hooks/workspaces/derived/use-logical-workspaces";
import {
  registerWorkspacePinIntentReconciler,
  type WorkspacePinIntentReconciler,
} from "#product/hooks/sessions/lifecycle/workspace-pin-intent-dispatch";
import {
  resolveWorkspacePinIntent,
  workspacePinIntentForEnvelope,
  type ResolvedWorkspacePinIntent,
  type WorkspacePinIntent,
} from "#product/lib/domain/workspaces/sidebar/workspace-pin-intents";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";

const MAX_PENDING_WORKSPACE_PIN_INTENTS = 128;

export function useWorkspacePinIntentReconciliation(): WorkspacePinIntentReconciler {
  const { logicalWorkspaces, isLoading } = useLogicalWorkspaces();
  const workspaceUiHydrated = useWorkspaceUiStore((state) => state._hydrated);
  const pendingByOperationRef = useRef(new Map<string, WorkspacePinIntent>());

  useEffect(() => {
    if (!workspaceUiHydrated || isLoading || pendingByOperationRef.current.size === 0) {
      return;
    }
    const resolved: ResolvedWorkspacePinIntent[] = [];
    for (const [operationKey, intent] of pendingByOperationRef.current) {
      const resolvedIntent = resolveWorkspacePinIntent(intent, logicalWorkspaces);
      if (resolvedIntent) {
        resolved.push(resolvedIntent);
        pendingByOperationRef.current.delete(operationKey);
      }
    }
    applyWorkspacePinIntents(resolved);
  }, [isLoading, logicalWorkspaces, workspaceUiHydrated]);

  return useCallback((envelopes) => {
    const intents: ResolvedWorkspacePinIntent[] = [];
    for (const envelope of envelopes) {
      const intent = workspacePinIntentForEnvelope(envelope);
      if (!intent) {
        continue;
      }
      const resolved = resolveWorkspacePinIntent(intent, logicalWorkspaces);
      if (resolved && workspaceUiHydrated) {
        pendingByOperationRef.current.delete(intentOperationKey(intent));
        intents.push(resolved);
      } else {
        rememberPendingIntent(pendingByOperationRef.current, intent);
      }
    }
    applyWorkspacePinIntents(intents);
  }, [isLoading, logicalWorkspaces, workspaceUiHydrated]);
}

export function useWorkspacePinIntentReconciliationLifecycle(): void {
  const reconcile = useWorkspacePinIntentReconciliation();
  useEffect(
    () => registerWorkspacePinIntentReconciler(reconcile),
    [reconcile],
  );
}

function applyWorkspacePinIntents(intents: ResolvedWorkspacePinIntent[]): void {
  if (intents.length > 0) {
    useWorkspaceUiStore.getState().applyWorkspacePinIntentBatch(intents);
  }
}

function rememberPendingIntent(
  pending: Map<string, WorkspacePinIntent>,
  intent: WorkspacePinIntent,
): void {
  pending.set(intentOperationKey(intent), intent);
  while (pending.size > MAX_PENDING_WORKSPACE_PIN_INTENTS) {
    const oldestKey = pending.keys().next().value;
    if (typeof oldestKey !== "string") {
      return;
    }
    pending.delete(oldestKey);
  }
}

function intentOperationKey(intent: WorkspacePinIntent): string {
  return JSON.stringify([intent.runtimeId, intent.sessionId, intent.requestId]);
}
