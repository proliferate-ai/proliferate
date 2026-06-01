import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
} from "@proliferate/cloud-sdk";
import { agentAuthenticationCopy } from "@/copy/settings/agent-authentication-copy";

export type PersonalCredentialConfirmationAction =
  | { kind: "share"; credential: AgentAuthCredential }
  | { kind: "revokeShare"; credential: AgentAuthCredential }
  | { kind: "deleteCredential"; credential: AgentAuthCredential };

export function localAuthDescription(
  agentKind: AgentAuthAgentKind,
  localSource: { detected: boolean; authMode?: string | null } | null,
  localSourceError: string | null,
) {
  if (localSourceError) {
    return "Desktop could not scan local credentials. Re-scan after the local auth files or environment are available.";
  }
  if (!localSource) {
    return agentKind === "opencode"
      ? "OpenCode local auth is session-only in Desktop V1. Shared cloud should use a team default when available."
      : "Desktop cannot sync this harness yet.";
  }
  if (!localSource.detected) {
    return "No local credential was detected on this Mac. Sign in locally, then re-scan.";
  }
  return localSource.authMode === "env"
    ? "Detected from local environment configuration. Syncing stores a cloud copy for personal cloud runs."
    : "Detected from the harness auth files on this Mac. Syncing stores a cloud copy for personal cloud runs.";
}

export function localAuthBadge(
  localSource: { detected: boolean } | null,
  localSourceError: string | null,
) {
  if (localSourceError) {
    return { label: "Scan failed", tone: "warning" as const };
  }
  if (!localSource) {
    return { label: "Unsupported", tone: "neutral" as const };
  }
  return localSource.detected
    ? { label: "Detected", tone: "success" as const }
    : { label: "Missing", tone: "neutral" as const };
}

export function cloudCredentialDescription(
  credentials: AgentAuthCredential[],
  credentialsLoading: boolean,
) {
  if (credentialsLoading) {
    return "Loading cloud credentials...";
  }
  return credentials.length > 0
    ? "Credentials synced from this Mac or added as personal gateway credentials."
    : agentAuthenticationCopy.noCloudCredentials;
}

export function confirmationTitle(action: PersonalCredentialConfirmationAction | null): string {
  if (!action) {
    return "";
  }
  if (action.kind === "share") {
    return "Allow team admins to use this credential?";
  }
  if (action.kind === "revokeShare") {
    return "Stop team use?";
  }
  return "Delete this cloud credential?";
}

export function confirmationDescription(
  action: PersonalCredentialConfirmationAction | null,
  selectedOrganizationName: string | null,
): string {
  if (!action) {
    return "";
  }
  if (action.kind === "share") {
    return `${action.credential.displayName} will be visible to admins for ${selectedOrganizationName ?? "the selected team"} shared cloud defaults.`;
  }
  if (action.kind === "revokeShare") {
    return `${action.credential.displayName} will no longer be available for shared cloud defaults. Existing runs may need their agent auth refreshed.`;
  }
  return `${action.credential.displayName} will be removed from Cloud. Local auth files on this Mac are not deleted.`;
}

export function confirmationConfirmLabel(
  action: PersonalCredentialConfirmationAction | null,
): string {
  if (!action) {
    return "";
  }
  if (action.kind === "share") {
    return "Allow team admins";
  }
  if (action.kind === "revokeShare") {
    return "Stop team use";
  }
  return "Delete cloud copy";
}
