import {
  enqueueCommand,
  getCommandStatus,
  type CloudCommandResponse,
} from "@proliferate/cloud-sdk";

const POLL_INTERVAL_MS = 500;
const START_SESSION_TIMEOUT_MS = 240_000;

interface StartCloudSessionCommandInput {
  idempotencyKey: string;
  targetId: string;
  cloudWorkspaceId: string;
  anyharnessWorkspaceId: string;
  agentKind: string;
  modelId: string;
  modeId?: string | null;
  subagentsEnabled: boolean;
}

export async function startCloudSessionCommand(
  input: StartCloudSessionCommandInput,
): Promise<string> {
  const command = await enqueueCommand({
    idempotencyKey: input.idempotencyKey,
    targetId: input.targetId,
    workspaceId: input.anyharnessWorkspaceId,
    cloudWorkspaceId: input.cloudWorkspaceId,
    kind: "start_session",
    source: "desktop_cloud_view",
    payload: {
      workspaceId: input.anyharnessWorkspaceId,
      agentKind: input.agentKind,
      modelId: input.modelId,
      ...(input.modeId ? { modeId: input.modeId } : {}),
      subagentsEnabled: input.subagentsEnabled,
      origin: { kind: "system", entrypoint: "cloud" },
    },
  });
  const completed = await waitForCommandTerminal(command.commandId);
  if (completed.status !== "accepted" && completed.status !== "accepted_but_queued") {
    throw new Error(
      completed.errorMessage
        || `Cloud session command ${completed.status}.`,
    );
  }
  return parseStartedSessionId(completed);
}

async function waitForCommandTerminal(commandId: string): Promise<CloudCommandResponse> {
  const deadline = Date.now() + START_SESSION_TIMEOUT_MS;
  let latest = await getCommandStatus(commandId);
  while (!isTerminalStatus(latest.status)) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the cloud session to start.");
    }
    await sleep(POLL_INTERVAL_MS);
    latest = await getCommandStatus(commandId);
  }
  return latest;
}

function isTerminalStatus(status: CloudCommandResponse["status"]): boolean {
  return status === "accepted"
    || status === "accepted_but_queued"
    || status === "rejected"
    || status === "expired"
    || status === "superseded"
    || status === "failed_delivery";
}

function parseStartedSessionId(command: CloudCommandResponse): string {
  const candidates = [
    command.result?.sessionId,
    command.result?.session_id,
    nestedString(command.result?.body, "sessionId"),
    nestedString(command.result?.body, "session_id"),
    nestedString(command.result?.body, "id"),
    nestedString(nestedObject(command.result?.body, "session"), "id"),
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  throw new Error("Cloud session command completed without a session id.");
}

function nestedObject(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const nested = (value as Record<string, unknown>)[key];
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : null;
}

function nestedString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === "string" ? nested : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
