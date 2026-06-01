import { logLatency } from "@/lib/infra/measurement/debug-latency";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";

export type InteractionAction = "permission" | "user_input" | "mcp_elicitation";

export function logInteractionDebug(
  event: string,
  input: {
    action: InteractionAction;
    sessionId: string | null;
    selectedWorkspaceId: string | null;
    slot: SessionRuntimeRecord | null;
    requestId?: string | null;
    extra?: Record<string, unknown>;
  },
): void {
  logLatency(`session.interaction.${event}`, {
    action: input.action,
    sessionId: input.sessionId,
    selectedWorkspaceId: input.selectedWorkspaceId,
    requestId: input.requestId ?? null,
    slotWorkspaceId: input.slot?.workspaceId ?? null,
    slotMaterializedSessionId: input.slot?.materializedSessionId ?? null,
    slotStatus: input.slot?.status ?? null,
    transcriptHydrated: input.slot?.transcriptHydrated ?? null,
    streamConnectionState: input.slot?.streamConnectionState ?? null,
    transcriptLastSeq: input.slot?.transcript.lastSeq ?? null,
    pendingInteractions: input.slot?.transcript.pendingInteractions.map((interaction) => ({
      requestId: interaction.requestId,
      kind: interaction.kind,
      toolCallId: interaction.toolCallId ?? null,
      toolKind: interaction.toolKind ?? null,
      toolStatus: interaction.toolStatus ?? null,
      linkedPlanId: interaction.linkedPlanId ?? null,
    })) ?? [],
    ...(input.extra ?? {}),
  });
}
