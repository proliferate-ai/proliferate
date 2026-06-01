import type { CloudCommandResponse } from "@proliferate/cloud-sdk";

export function commandPendingMessage(status: CloudCommandResponse["status"]): string | null {
  switch (status) {
    case "queued":
      return "Command queued; waiting for the cloud runtime.";
    case "leased":
      return "Cloud runtime is picking up the command.";
    case "delivered":
      return "Command delivered; waiting for runtime acknowledgement.";
    default:
      return null;
  }
}

export function isTerminalCommandStatus(status: CloudCommandResponse["status"]): boolean {
  return status === "accepted"
    || status === "accepted_but_queued"
    || status === "rejected"
    || status === "expired"
    || status === "superseded"
    || status === "failed_delivery";
}

export function isRejectedCommandStatus(status: CloudCommandResponse["status"]): boolean {
  return status === "rejected"
    || status === "expired"
    || status === "superseded"
    || status === "failed_delivery";
}

export function assertCommandEnqueued(command: CloudCommandResponse): void {
  if (isRejectedCommandStatus(command.status)) {
    throw new Error(command.errorMessage || `Cloud command ${command.status}.`);
  }
}

export function assertCommandAccepted(command: CloudCommandResponse): void {
  if (command.status !== "accepted" && command.status !== "accepted_but_queued") {
    throw new Error(command.errorMessage || `Cloud command ${command.status}.`);
  }
}

export function isRecoverableCloudDispatchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b(failed to fetch|network|load failed|connection|aborted|timeout|timed out)\b/i
    .test(message);
}
