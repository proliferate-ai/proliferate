import {
  getCommandStatus,
  type CloudCommandResponse,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";

import {
  commandPendingMessage,
  isRecoverableCloudDispatchError,
  isTerminalCommandStatus,
} from "./cloud-command-status";

export async function waitForCommandTerminal(
  commandId: string,
  client: ProliferateCloudClient,
  shouldContinue: () => boolean,
  onStatus?: (status: string) => void,
): Promise<CloudCommandResponse> {
  const deadline = Date.now() + 240_000;
  assertStillCurrent(shouldContinue);
  let latest = await getCommandStatusWithRecoverableRetry({
    commandId,
    client,
    shouldContinue,
    deadline,
  });
  let delayMs = 500;
  let lastStatusMessage: string | null = null;
  while (!isTerminalCommandStatus(latest.status)) {
    assertStillCurrent(shouldContinue);
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the cloud command to finish.");
    }
    const nextStatusMessage = commandPendingMessage(latest.status);
    if (nextStatusMessage && nextStatusMessage !== lastStatusMessage) {
      onStatus?.(nextStatusMessage);
      lastStatusMessage = nextStatusMessage;
    }
    await sleep(delayMs);
    delayMs = nextPollDelay(delayMs);
    assertStillCurrent(shouldContinue);
    latest = await getCommandStatusWithRecoverableRetry({
      commandId,
      client,
      shouldContinue,
      deadline,
    });
  }
  assertStillCurrent(shouldContinue);
  return latest;
}

export async function getCommandStatusWithRecoverableRetry(args: {
  commandId: string;
  client: ProliferateCloudClient;
  shouldContinue: () => boolean;
  deadline: number;
}): Promise<CloudCommandResponse> {
  let delayMs = 500;
  let lastError: unknown = null;
  while (Date.now() < args.deadline) {
    assertStillCurrent(args.shouldContinue);
    try {
      return await getCommandStatus(args.commandId, args.client);
    } catch (error) {
      lastError = error;
      if (!isRecoverableCloudDispatchError(error)) {
        throw error;
      }
      await sleep(delayMs);
      delayMs = nextPollDelay(delayMs);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Timed out waiting for the cloud command to finish.");
}

export async function refreshCommandStatus(
  fallback: CloudCommandResponse,
  client: ProliferateCloudClient,
  shouldContinue: () => boolean,
): Promise<CloudCommandResponse> {
  assertStillCurrent(shouldContinue);
  try {
    return await getCommandStatus(fallback.commandId, client);
  } catch {
    return fallback;
  }
}

export function assertStillCurrent(shouldContinue: () => boolean): void {
  if (!shouldContinue()) {
    throw new Error("Queued prompt handoff was cancelled.");
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function nextPollDelay(currentMs: number): number {
  return Math.min(Math.round(currentMs * 1.5), 2_500);
}
