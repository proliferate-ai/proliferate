import type { useDeletePendingPromptMutation, useEditPendingPromptMutation, useResolveSessionInteractionMutation } from "@anyharness/sdk-react";
import type { DesktopSshBridge } from "@proliferate/product-client/host/desktop-bridge";
import type { CloudSandboxGatewayUrlSource } from "@/lib/access/cloud/cloud-sandbox-gateway";
import type {
  SessionIntent,
} from "@proliferate/product-domain/sessions/intents/session-intent-model";
import {
  getSessionClientAndWorkspace,
} from "@/lib/access/anyharness/session-runtime";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";

type ResolveInteractionMutation = ReturnType<typeof useResolveSessionInteractionMutation>;
type EditPendingPromptMutation = ReturnType<typeof useEditPendingPromptMutation>;
type DeletePendingPromptMutation = ReturnType<typeof useDeletePendingPromptMutation>;

export interface InteractionIntentDispatchDeps {
  ssh?: DesktopSshBridge | null;
  cloudClient: CloudSandboxGatewayUrlSource | null;
  deletePendingPromptMutation: DeletePendingPromptMutation;
  editPendingPromptMutation: EditPendingPromptMutation;
  resolveInteractionMutation: ResolveInteractionMutation;
}

export async function dispatchInteractionIntent(
  intent: Extract<SessionIntent, { kind: "resolve_interaction" }>,
  deps: Pick<InteractionIntentDispatchDeps, "resolveInteractionMutation" | "ssh" | "cloudClient">,
): Promise<void> {
  const current = useSessionIntentStore.getState().entriesById[intent.intentId];
  if (!current || current.kind !== "resolve_interaction" || current.status !== "queued") {
    return;
  }
  useSessionIntentStore.getState().patchIntent(intent.intentId, {
    status: "dispatching",
    errorMessage: null,
    dispatchedAt: new Date().toISOString(),
  });
  try {
    const { workspaceId, materializedSessionId } = await getSessionClientAndWorkspace(
      intent.clientSessionId,
      deps.ssh ?? null,
      deps.cloudClient,
    );
    useSessionIntentStore.getState().bindMaterializedSession(
      intent.clientSessionId,
      materializedSessionId,
    );
    await deps.resolveInteractionMutation.mutateAsync({
      workspaceId,
      sessionId: materializedSessionId,
      requestId: intent.requestId,
      request: intent.request,
    });
    useSessionIntentStore.getState().patchIntent(intent.intentId, {
      status: "accepted",
      materializedSessionId,
      workspaceId,
      acceptedAt: new Date().toISOString(),
      errorMessage: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stale = /not found|missing|unknown/i.test(message);
    useSessionIntentStore.getState().patchIntent(intent.intentId, {
      status: stale ? "stale" : "failed",
      errorMessage: stale ? null : message,
    });
  }
}

export async function dispatchEditPendingPromptIntent(
  intent: Extract<SessionIntent, { kind: "edit_pending_prompt" }>,
  deps: Pick<InteractionIntentDispatchDeps, "editPendingPromptMutation" | "ssh" | "cloudClient">,
): Promise<void> {
  useSessionIntentStore.getState().patchIntent(intent.intentId, {
    status: "dispatching",
    errorMessage: null,
    dispatchedAt: new Date().toISOString(),
  });
  try {
    const { materializedSessionId } = await getSessionClientAndWorkspace(
      intent.clientSessionId,
      deps.ssh ?? null,
      deps.cloudClient,
    );
    await deps.editPendingPromptMutation.mutateAsync({
      sessionId: materializedSessionId,
      seq: intent.seq,
      text: intent.text,
    });
    useSessionIntentStore.getState().patchIntent(intent.intentId, {
      status: "accepted",
      materializedSessionId,
      acceptedAt: new Date().toISOString(),
    });
  } catch (error) {
    useSessionIntentStore.getState().patchIntent(intent.intentId, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function dispatchDeletePendingPromptIntent(
  intent: Extract<SessionIntent, { kind: "delete_pending_prompt" }>,
  deps: Pick<InteractionIntentDispatchDeps, "deletePendingPromptMutation" | "ssh" | "cloudClient">,
): Promise<void> {
  useSessionIntentStore.getState().patchIntent(intent.intentId, {
    status: "dispatching",
    errorMessage: null,
    dispatchedAt: new Date().toISOString(),
  });
  try {
    const { materializedSessionId } = await getSessionClientAndWorkspace(
      intent.clientSessionId,
      deps.ssh ?? null,
      deps.cloudClient,
    );
    await deps.deletePendingPromptMutation.mutateAsync({
      sessionId: materializedSessionId,
      seq: intent.seq,
    });
    useSessionIntentStore.getState().patchIntent(intent.intentId, {
      status: "accepted",
      materializedSessionId,
      acceptedAt: new Date().toISOString(),
    });
  } catch (error) {
    useSessionIntentStore.getState().patchIntent(intent.intentId, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}
