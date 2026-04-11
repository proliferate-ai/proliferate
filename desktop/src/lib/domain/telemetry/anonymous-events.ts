import type { DesktopProductEventMap } from "./events";
import type { DesktopTelemetryMode } from "./mode";

export const ANONYMOUS_TELEMETRY_SCHEMA_VERSION = 1;

export type AnonymousTelemetrySurface = "desktop" | "server";
export type AnonymousTelemetryRecordType = "VERSION" | "ACTIVATION" | "USAGE";
export type AnonymousTelemetryActivationMilestone =
  | "first_launch"
  | "first_prompt_submitted"
  | "first_local_workspace_created"
  | "first_cloud_workspace_created"
  | "first_credential_synced"
  | "first_connector_installed";

export interface AnonymousUsageCounters {
  sessionsStarted: number;
  promptsSubmitted: number;
  workspacesCreatedLocal: number;
  workspacesCreatedCloud: number;
  credentialsSynced: number;
  connectorsInstalled: number;
}

export interface AnonymousTelemetryPersistedState {
  schemaVersion: number;
  sentMilestones: AnonymousTelemetryActivationMilestone[];
  pendingMilestones: AnonymousTelemetryActivationMilestone[];
  usageCounters: AnonymousUsageCounters;
  lastUsageFlushedAt: string | null;
}

export interface AnonymousVersionPayload {
  appVersion: string;
  platform: string;
  arch: string;
}

export interface AnonymousActivationPayload {
  milestone: AnonymousTelemetryActivationMilestone;
}

export interface AnonymousUsagePayload extends AnonymousUsageCounters {}

export type AnonymousTelemetryPayload =
  | AnonymousVersionPayload
  | AnonymousActivationPayload
  | AnonymousUsagePayload;

export interface AnonymousTelemetryEnvelope {
  installUuid: string;
  surface: AnonymousTelemetrySurface;
  telemetryMode: DesktopTelemetryMode;
  recordType: AnonymousTelemetryRecordType;
  payload: AnonymousTelemetryPayload;
}

export type AnonymousUsageCounterKey = keyof AnonymousUsageCounters;

export type AnonymousTelemetryDirective =
  | {
    kind: "increment_usage";
    counter: AnonymousUsageCounterKey;
  }
  | {
    kind: "mark_activation";
    milestone: AnonymousTelemetryActivationMilestone;
  };

export function createEmptyAnonymousUsageCounters(): AnonymousUsageCounters {
  return {
    sessionsStarted: 0,
    promptsSubmitted: 0,
    workspacesCreatedLocal: 0,
    workspacesCreatedCloud: 0,
    credentialsSynced: 0,
    connectorsInstalled: 0,
  };
}

export function createDefaultAnonymousTelemetryPersistedState(): AnonymousTelemetryPersistedState {
  return {
    schemaVersion: ANONYMOUS_TELEMETRY_SCHEMA_VERSION,
    sentMilestones: [],
    pendingMilestones: [],
    usageCounters: createEmptyAnonymousUsageCounters(),
    lastUsageFlushedAt: null,
  };
}

export function hasAnonymousUsageCounters(
  counters: AnonymousUsageCounters,
): boolean {
  return Object.values(counters).some((value) => value > 0);
}

export function copyAnonymousUsageCounters(
  counters: AnonymousUsageCounters,
): AnonymousUsageCounters {
  return { ...counters };
}

export function deriveAnonymousTelemetryDirectives<
  E extends keyof DesktopProductEventMap,
>(
  name: E,
  _properties: DesktopProductEventMap[E],
): AnonymousTelemetryDirective[] {
  switch (name) {
    case "chat_session_created":
      return [{ kind: "increment_usage", counter: "sessionsStarted" }];
    case "chat_prompt_submitted":
      return [
        { kind: "mark_activation", milestone: "first_prompt_submitted" },
        { kind: "increment_usage", counter: "promptsSubmitted" },
      ];
    case "workspace_created":
      return [
        { kind: "mark_activation", milestone: "first_local_workspace_created" },
        { kind: "increment_usage", counter: "workspacesCreatedLocal" },
      ];
    case "cloud_workspace_created":
      return [
        { kind: "mark_activation", milestone: "first_cloud_workspace_created" },
        { kind: "increment_usage", counter: "workspacesCreatedCloud" },
      ];
    case "cloud_credential_synced":
      return [
        { kind: "mark_activation", milestone: "first_credential_synced" },
        { kind: "increment_usage", counter: "credentialsSynced" },
      ];
    case "connector_install_succeeded":
      return [
        { kind: "mark_activation", milestone: "first_connector_installed" },
        { kind: "increment_usage", counter: "connectorsInstalled" },
      ];
    default:
      return [];
  }
}
