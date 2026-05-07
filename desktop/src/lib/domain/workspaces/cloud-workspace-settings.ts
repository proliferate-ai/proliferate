import { ProliferateClientError } from "@/lib/access/cloud/client";

interface CloudWorkspaceSettingsErrorSources {
  credentialError: Error | null;
  fileError: Error | null;
  setupError: Error | null;
  lastApplyError: string | null | undefined;
}

export function formatCloudWorkspaceSettingsError(
  sources: CloudWorkspaceSettingsErrorSources,
): string | null {
  const { credentialError, fileError, setupError, lastApplyError } = sources;

  if (credentialError) {
    return `Credential sync failed: ${formatCredentialErrorMessage(credentialError)}`;
  }
  if (fileError) {
    return `File re-sync failed: ${fileError.message}`;
  }
  if (setupError) {
    return `Setup start failed: ${setupError.message}`;
  }
  if (lastApplyError) {
    return lastApplyError;
  }
  return null;
}

function formatCredentialErrorMessage(error: Error): string {
  if (
    error instanceof ProliferateClientError
    && error.code === "workspace_not_ready"
  ) {
    return "Start the workspace before re-syncing credentials.";
  }
  return error.message;
}

export function buildCloudWorkspaceSetupStatusLabel(status: string | undefined): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    default:
      return "Idle";
  }
}

export function buildCloudWorkspacePostReadyLabel(phase: string | null | undefined): string {
  switch (phase) {
    case "applying_files":
      return "Applying tracked files";
    case "starting_setup":
      return "Starting setup";
    case "failed":
      return "Apply failed";
    case "completed":
      return "Completed";
    default:
      return "Idle";
  }
}
