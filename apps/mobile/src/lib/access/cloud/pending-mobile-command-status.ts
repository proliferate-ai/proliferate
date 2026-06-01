import {
  getCommandStatus,
  type CloudCommandResponse,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";

import {
  isRetryableReadinessErrorCode,
  RetryablePendingPromptDispatchError,
} from "./pending-mobile-prompt-errors";
import {
  assertStillCurrent,
  nextPollDelay,
  sleep,
} from "./pending-mobile-prompt-polling";

export async function waitForCommandAccepted(
  initialCommand: CloudCommandResponse,
  client: ProliferateCloudClient,
  shouldContinue: () => boolean,
): Promise<CloudCommandResponse> {
  const deadline = Date.now() + 240_000;
  let latestCommand = initialCommand;
  let delayMs = 500;
  assertStillCurrent(shouldContinue);
  while (true) {
    latestCommand = await refreshCommandStatus(latestCommand, client, shouldContinue);
    assertCommandEnqueued(latestCommand);
    if (latestCommand.status === "accepted" || latestCommand.status === "accepted_but_queued") {
      return latestCommand;
    }
    assertStillCurrent(shouldContinue);
    if (Date.now() >= deadline) {
      throw new RetryablePendingPromptDispatchError(
        "Still waiting for the cloud command to be accepted. Retrying queued prompt handoff.",
      );
    }
    await sleep(delayMs);
    delayMs = nextPollDelay(delayMs);
  }
}

export async function waitForCommandTerminal(
  commandId: string,
  client: ProliferateCloudClient,
  shouldContinue: () => boolean,
  onStatus?: (status: string) => void,
): Promise<CloudCommandResponse> {
  const deadline = Date.now() + 240_000;
  let latest = await getCommandStatus(commandId, client);
  let delayMs = 500;
  let lastStatusMessage: string | null = null;
  assertStillCurrent(shouldContinue);
  while (!isTerminalStatus(latest.status)) {
    assertStillCurrent(shouldContinue);
    if (Date.now() >= deadline) {
      throw new RetryablePendingPromptDispatchError(
        "Still waiting for the cloud command to finish. Retrying queued prompt handoff.",
      );
    }
    const nextStatusMessage = commandPendingMessage(latest.status);
    if (nextStatusMessage && nextStatusMessage !== lastStatusMessage) {
      onStatus?.(nextStatusMessage);
      lastStatusMessage = nextStatusMessage;
    }
    await sleep(delayMs);
    delayMs = nextPollDelay(delayMs);
    assertStillCurrent(shouldContinue);
    latest = await getCommandStatus(commandId, client);
  }
  assertStillCurrent(shouldContinue);
  return latest;
}

export function assertCommandEnqueued(command: CloudCommandResponse): void {
  if (
    command.status === "rejected" ||
    command.status === "expired" ||
    command.status === "superseded" ||
    command.status === "failed_delivery"
  ) {
    if (isRetryableReadinessErrorCode(command.errorCode)) {
      throw new RetryablePendingPromptDispatchError(
        command.errorMessage || "Workspace runtime is still preparing for session start.",
      );
    }
    throw new Error(command.errorMessage || `Cloud command ${command.status}.`);
  }
}

export function assertCommandAccepted(command: CloudCommandResponse): void {
  if (command.status !== "accepted" && command.status !== "accepted_but_queued") {
    throw new Error(command.errorMessage || `Cloud command ${command.status}.`);
  }
}

export function parseStartedSessionId(command: CloudCommandResponse): string | null {
  const result = commandResultObject(command);
  const body = commandResultBodyObject(command);
  const candidates = [
    command.sessionId,
    result?.sessionId,
    result?.session_id,
    nestedString(body, "sessionId"),
    nestedString(body, "session_id"),
    nestedString(body, "id"),
    nestedString(nestedObject(body, "session"), "id"),
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

export function configApplyState(command: CloudCommandResponse): string | null {
  const result = commandResultObject(command);
  const body = commandResultBodyObject(command);
  return nestedString(body, "applyState")
    ?? nestedString(result, "applyState");
}

async function refreshCommandStatus(
  fallback: CloudCommandResponse,
  client: ProliferateCloudClient,
  shouldContinue: () => boolean,
): Promise<CloudCommandResponse> {
  assertStillCurrent(shouldContinue);
  try {
    return await getCommandStatus(fallback.commandId, client);
  } catch {
    // Command-status reads can briefly race the command creation response.
    return fallback;
  }
}

function isTerminalStatus(status: CloudCommandResponse["status"]): boolean {
  return status === "accepted"
    || status === "accepted_but_queued"
    || status === "rejected"
    || status === "expired"
    || status === "superseded"
    || status === "failed_delivery";
}

function commandPendingMessage(status: CloudCommandResponse["status"]): string | null {
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

function commandResultObject(command: CloudCommandResponse): Record<string, unknown> | null {
  return objectFromUnknown(command.result);
}

function commandResultBodyObject(command: CloudCommandResponse): Record<string, unknown> | null {
  const result = commandResultObject(command);
  return objectFromUnknown(result?.body);
}

function nestedObject(value: unknown, key: string): Record<string, unknown> | null {
  const object = objectFromUnknown(value);
  if (!object) {
    return null;
  }
  const nested = object[key];
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : null;
}

function nestedString(value: unknown, key: string): string | null {
  const object = objectFromUnknown(value);
  if (!object) return null;
  const nested = object[key];
  return typeof nested === "string" ? nested : null;
}

function objectFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return objectFromUnknown(parsed);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
