import { useCallback, useEffect, useRef } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  useDeletePendingPromptMutation,
  useEditPendingPromptMutation,
  usePromptSessionMutation,
  useResolveSessionInteractionMutation,
  useSetSessionConfigOptionMutation,
} from "@anyharness/sdk-react";
import {
  selectNextDispatchableSessionIntent,
} from "@proliferate/product-domain/sessions/intents/session-intent-selectors";
import type {
  SessionIntent,
} from "@proliferate/product-domain/sessions/intents/session-intent-model";
import { useSessionHistoryHydration } from "@/hooks/sessions/lifecycle/use-session-history-hydration";
import { useSessionSummaryActions } from "@/hooks/sessions/workflows/use-session-summary-actions";
import { useSessionTitleActions } from "@/hooks/sessions/workflows/use-session-title-actions";
import { useWorkspaceNameActions } from "@/hooks/workspaces/workflows/use-workspace-name-actions";
import { useWorkspaceSurfaceLookup } from "@/hooks/workspaces/derived/use-workspace-surface-lookup";
import { useWorkspaceSessionCache } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import { getSessionRecord } from "@/stores/sessions/session-records";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import {
  dispatchConfigIntent,
} from "@/hooks/sessions/lifecycle/session-intent-config-dispatch";
import {
  dispatchDeletePendingPromptIntent,
  dispatchEditPendingPromptIntent,
  dispatchInteractionIntent,
} from "@/hooks/sessions/lifecycle/session-intent-interaction-dispatch";
import {
  dispatchPromptIntent,
} from "@/hooks/sessions/lifecycle/session-intent-prompt-dispatch";

let activeDispatcherOwner: symbol | null = null;

export function useSessionIntentDispatcher(): void {
  const ssh = useProductHost().desktop?.ssh ?? null;
  const dispatchVersion = useSessionIntentStore((state) => state.dispatchVersion);
  const { rehydrateSessionSlotFromHistory } = useSessionHistoryHydration();
  const { applySessionSummary } = useSessionSummaryActions();
  const { maybeGenerateSessionTitle } = useSessionTitleActions();
  const { maybeGenerateWorkspaceName } = useWorkspaceNameActions();
  const { getWorkspaceSurface } = useWorkspaceSurfaceLookup();
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();
  const promptSessionMutation = usePromptSessionMutation();
  const setSessionConfigOptionMutation = useSetSessionConfigOptionMutation();
  const resolveInteractionMutation = useResolveSessionInteractionMutation();
  const editPendingPromptMutation = useEditPendingPromptMutation();
  const deletePendingPromptMutation = useDeletePendingPromptMutation();
  const inFlightSessionIdsRef = useRef(new Set<string>());
  const dispatcherOwnerRef = useRef<symbol | null>(null);

  useEffect(() => {
    if (activeDispatcherOwner) {
      return;
    }
    const owner = Symbol("session-intent-dispatcher");
    activeDispatcherOwner = owner;
    dispatcherOwnerRef.current = owner;
    return () => {
      if (activeDispatcherOwner === owner) {
        activeDispatcherOwner = null;
      }
      dispatcherOwnerRef.current = null;
    };
  }, []);

  const dispatchIntent = useCallback(async (intent: SessionIntent) => {
    switch (intent.kind) {
      case "send_prompt":
        await dispatchPromptIntent(intent, {
          applySessionSummary,
          maybeGenerateSessionTitle,
          maybeGenerateWorkspaceName,
          promptSessionMutation,
          rehydrateSessionSlotFromHistory,
          ssh,
          upsertWorkspaceSessionRecord,
        });
        break;
      case "update_config":
        await dispatchConfigIntent(intent, {
          getWorkspaceSurface,
          setSessionConfigOptionMutation,
          ssh,
          upsertWorkspaceSessionRecord,
        });
        break;
      case "resolve_interaction":
        await dispatchInteractionIntent(intent, { resolveInteractionMutation, ssh });
        break;
      case "edit_pending_prompt":
        await dispatchEditPendingPromptIntent(intent, { editPendingPromptMutation, ssh });
        break;
      case "delete_pending_prompt":
        await dispatchDeletePendingPromptIntent(intent, { deletePendingPromptMutation, ssh });
        break;
    }
  }, [
    applySessionSummary,
    deletePendingPromptMutation,
    editPendingPromptMutation,
    getWorkspaceSurface,
    maybeGenerateSessionTitle,
    maybeGenerateWorkspaceName,
    promptSessionMutation,
    rehydrateSessionSlotFromHistory,
    resolveInteractionMutation,
    setSessionConfigOptionMutation,
    ssh,
    upsertWorkspaceSessionRecord,
  ]);

  useEffect(() => {
    if (!isActiveDispatcherOwner(dispatcherOwnerRef.current)) {
      return;
    }

    const state = useSessionIntentStore.getState();
    for (const clientSessionId of Object.keys(state.intentIdsByClientSessionId)) {
      if (inFlightSessionIdsRef.current.has(clientSessionId)) {
        continue;
      }
      const intent = selectNextDispatchableSessionIntent(state, clientSessionId);
      if (!intent) {
        continue;
      }
      const record = getSessionRecord(clientSessionId);
      if (!record?.materializedSessionId) {
        logLatency("session.intent.dispatch.waiting_unmaterialized", {
          clientSessionId,
          nextIntentId: intent.intentId,
          nextIntentKind: intent.kind,
          hasRecord: Boolean(record),
          workspaceId: record?.workspaceId ?? intent.workspaceId,
          status: record?.status ?? null,
          transcriptHydrated: record?.transcriptHydrated ?? null,
          intentWorkspaceId: intent.workspaceId,
          intentCount: state.intentIdsByClientSessionId[clientSessionId]?.length ?? 0,
        });
        continue;
      }
      inFlightSessionIdsRef.current.add(clientSessionId);
      void dispatchIntent(intent).finally(() => {
        inFlightSessionIdsRef.current.delete(clientSessionId);
      });
    }
  }, [dispatchIntent, dispatchVersion]);
}

function isActiveDispatcherOwner(owner: symbol | null): boolean {
  return owner !== null && activeDispatcherOwner === owner;
}
