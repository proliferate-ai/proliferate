import { useCallback, useEffect, useRef } from "react";
import { useLogicalWorkspaces } from "#product/hooks/workspaces/derived/use-logical-workspaces";
import {
  registerWorkspacePinIntentReconciler,
  type WorkspacePinIntentReconciler,
} from "#product/hooks/sessions/lifecycle/workspace-pin-intent-dispatch";
import {
  resolveWorkspacePinIntent,
  workspacePinIntentForEnvelope,
  type ObservedWorkspacePinIntent,
  type ResolvedWorkspacePinIntent,
} from "#product/lib/domain/workspaces/sidebar/workspace-pin-intents";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";

const MAX_PENDING_WORKSPACE_PIN_INTENTS = 128;

export function useWorkspacePinIntentReconciliation(): WorkspacePinIntentReconciler {
  const { logicalWorkspaces, isLoading } = useLogicalWorkspaces();
  const workspaceUiHydrated = useWorkspaceUiStore((state) => state._hydrated);
  const pendingByOperationRef = useRef(new Map<string, ObservedWorkspacePinIntent>());

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

  return useCallback((observations) => {
    const intents: ResolvedWorkspacePinIntent[] = [];
    for (const observation of observations) {
      const parsedIntent = workspacePinIntentForEnvelope(observation.envelope);
      if (!parsedIntent) {
        continue;
      }
      const intent: ObservedWorkspacePinIntent = {
        ...parsedIntent,
        observedAt: observation.observedAt,
        provenance: observation.provenance,
      };
      const operationKey = intentOperationKey(intent);
      const authoritativeIntent = pendingByOperationRef.current.get(operationKey) ?? intent;
      const resolved = resolveWorkspacePinIntent(authoritativeIntent, logicalWorkspaces);
      if (resolved && workspaceUiHydrated && !isLoading) {
        pendingByOperationRef.current.delete(operationKey);
        intents.push(resolved);
      } else {
        rememberPendingIntent(pendingByOperationRef.current, authoritativeIntent);
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
  pending: Map<string, ObservedWorkspacePinIntent>,
  intent: ObservedWorkspacePinIntent,
): void {
  const operationKey = intentOperationKey(intent);
  if (pending.has(operationKey)) {
    return;
  }
  pending.set(operationKey, intent);
  while (pending.size > MAX_PENDING_WORKSPACE_PIN_INTENTS) {
    const oldestKey = pending.keys().next().value;
    if (typeof oldestKey !== "string") {
      return;
    }
    pending.delete(oldestKey);
  }
}

function intentOperationKey(intent: ObservedWorkspacePinIntent): string {
  return JSON.stringify([intent.runtimeId, intent.sessionId, intent.requestId]);
}
