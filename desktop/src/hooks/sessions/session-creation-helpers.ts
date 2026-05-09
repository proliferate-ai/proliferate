import type {
  ContentPart,
  PromptInputBlock,
} from "@anyharness/sdk";
import type { ConnectorLaunchResolutionWarning } from "@/lib/domain/mcp/types";
import { getLatencyFlowRequestHeaders } from "@/lib/infra/measurement/latency-flow";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";
import type { MeasurementOperationId } from "@/lib/infra/measurement/debug-measurement";
import type { PromptAttachmentSnapshot } from "@/lib/domain/chat/composer/prompt-attachment-snapshot";
import { batchSessionStoreWrites } from "@/lib/infra/scheduling/react-batching";
import {
  patchSessionRecord,
  removeSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";

export function buildLatencyRequestOptions(latencyFlowId?: string | null) {
  const headers = getLatencyFlowRequestHeaders(latencyFlowId);
  return headers ? { headers } : undefined;
}

export interface SessionCreateWithResolvedConfigRetryOptions {
  text: string;
  blocks?: PromptInputBlock[];
  attachmentSnapshots?: PromptAttachmentSnapshot[];
  optimisticContentParts?: ContentPart[];
  agentKind: string;
  modelId: string;
  modeId?: string;
  launchControlValues?: Record<string, string>;
  workspaceId?: string;
  latencyFlowId?: string | null;
  measurementOperationId?: MeasurementOperationId | null;
  promptId?: string | null;
  launchIntentId?: string | null;
  clientSessionId?: string | null;
  reuseInFlightEmptySession?: boolean;
  preferExistingCompatibleSession?: boolean;
  modelAvailabilityRetryCount?: number;
  skipInitialPromptEnqueue?: boolean;
  onBeforeOptimisticPrompt?: (workspaceId: string) => Promise<void> | void;
}

export function buildModelAvailabilityRetryOptions({
  options,
  pendingSessionId,
  promptId,
  hasPrompt,
}: {
  options: SessionCreateWithResolvedConfigRetryOptions;
  pendingSessionId: string;
  promptId: string | null;
  hasPrompt: boolean;
}): SessionCreateWithResolvedConfigRetryOptions {
  return {
    ...options,
    clientSessionId: pendingSessionId,
    promptId,
    latencyFlowId: null,
    measurementOperationId: null,
    reuseInFlightEmptySession: false,
    skipInitialPromptEnqueue: hasPrompt,
  };
}

export function materializeSessionRecord(
  clientSessionId: string,
  materializedSessionId: string,
  record: SessionRuntimeRecord,
): void {
  batchSessionStoreWrites(() => {
    patchSessionRecord(clientSessionId, {
      ...record,
      sessionId: clientSessionId,
      materializedSessionId,
    });
  });
}

export function removeSessionRecordAndClearSelection(sessionId: string): void {
  batchSessionStoreWrites(() => {
    removeSessionRecord(sessionId);
    const selection = useSessionSelectionStore.getState();
    if (selection.activeSessionId === sessionId) {
      selection.setActiveSessionId(null);
    }
  });
}

export function reportConnectorLaunchWarnings(
  warnings: ConnectorLaunchResolutionWarning[],
  showToast: (message: string, type?: "error" | "info") => void,
) {
  if (warnings.length === 0) {
    return;
  }

  for (const warning of warnings) {
    trackProductEvent("connector_skipped_at_launch", {
      connector_id: warning.catalogEntryId,
      reason_kind: warning.kind,
    });
  }

  if (warnings.length === 1) {
    const warning = warnings[0]!;
    if (warning.kind === "unsupported_target") {
      showToast(`${warning.connectorName} wasn't available in this session because it only supports local runtimes.`, "info");
      return;
    }
    if (warning.kind === "command_missing") {
      showToast(`${warning.connectorName} wasn't available in this session because its local command wasn't installed.`, "info");
      return;
    }
    if (warning.kind === "workspace_path_unresolved") {
      showToast(`${warning.connectorName} wasn't available in this session because the workspace path couldn't be resolved.`, "info");
      return;
    }
    if (warning.kind === "needs_reconnect") {
      showToast(`${warning.connectorName} wasn't available in this session because it needs reconnecting.`, "info");
      return;
    }
    showToast(`${warning.connectorName} wasn't available in this session because it needs a token.`, "info");
    return;
  }

  showToast(`${warnings.length} connectors weren't available in this session.`, "info");
}
