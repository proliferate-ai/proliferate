import {
  enqueueCommand,
  getCommandStatus,
  type CloudCommandResponse,
} from "@proliferate/cloud-sdk";
import type {
  PromptInputBlock,
  PromptSessionResponse,
  Session,
} from "@anyharness/sdk";

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

export interface StartCloudSessionCommandResult {
  sessionId: string;
  session: Session | null;
}

interface SendCloudPromptCommandInput {
  idempotencyKey: string;
  targetId: string;
  cloudWorkspaceId: string;
  anyharnessWorkspaceId: string;
  sessionId: string;
  promptId: string;
  blocks: PromptInputBlock[];
  text: string;
}

export async function startCloudSessionCommand(
  input: StartCloudSessionCommandInput,
): Promise<string> {
  return (await startCloudSessionCommandResult(input)).sessionId;
}

export async function startCloudSessionCommandResult(
  input: StartCloudSessionCommandInput,
): Promise<StartCloudSessionCommandResult> {
  const command = await enqueueCommand({
    idempotencyKey: input.idempotencyKey,
    targetId: input.targetId,
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
    throw new Error(commandFailureMessage(completed));
  }
  return {
    sessionId: parseStartedSessionId(completed),
    session: parseSessionResult(completed),
  };
}

export async function sendCloudPromptCommand(
  input: SendCloudPromptCommandInput,
): Promise<PromptSessionResponse | null> {
  try {
    return await sendCloudPromptCommandOnce(input);
  } catch (error) {
    if (!isCloudSessionProjectionMissing(error)) {
      throw error;
    }
    await backfillCloudWorkspaceProjectionForPrompt(input, error);
    return sendCloudPromptCommandOnce(input);
  }
}

async function sendCloudPromptCommandOnce(
  input: SendCloudPromptCommandInput,
): Promise<PromptSessionResponse | null> {
  const command = await enqueueCommand({
    idempotencyKey: input.idempotencyKey,
    targetId: input.targetId,
    workspaceId: input.anyharnessWorkspaceId,
    cloudWorkspaceId: input.cloudWorkspaceId,
    sessionId: input.sessionId,
    kind: "send_prompt",
    source: "desktop_cloud_view",
    payload: {
      promptId: input.promptId,
      blocks: input.blocks,
      text: input.text,
    },
  });
  const completed = await waitForCommandTerminal(command.commandId);
  if (completed.status !== "accepted" && completed.status !== "accepted_but_queued") {
    throw new Error(commandFailureMessage(completed));
  }
  return parsePromptSessionResponse(completed);
}

async function backfillCloudWorkspaceProjectionForPrompt(
  input: SendCloudPromptCommandInput,
  originalError: unknown,
): Promise<void> {
  try {
    const command = await enqueueCommand({
      idempotencyKey: `desktop:backfill-session-projection:${input.cloudWorkspaceId}:${input.sessionId}:${input.promptId}`,
      targetId: input.targetId,
      workspaceId: input.anyharnessWorkspaceId,
      cloudWorkspaceId: input.cloudWorkspaceId,
      kind: "backfill_exposed_workspace",
      source: "desktop_cloud_view",
      payload: {
        workspaceId: input.anyharnessWorkspaceId,
      },
    });
    const completed = await waitForCommandTerminal(command.commandId);
    if (completed.status !== "accepted" && completed.status !== "accepted_but_queued") {
      throw new Error(commandFailureMessage(completed));
    }
  } catch (repairError) {
    throw new Error(
      `${errorMessage(originalError)} Tried to refresh the Cloud projection, but that also failed: ${errorMessage(repairError)}`,
    );
  }
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

function isCloudSessionProjectionMissing(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === "object"
      && "code" in error
      && (error as { code?: unknown }).code === "cloud_command_session_not_projected",
  );
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

function parseSessionResult(command: CloudCommandResponse): Session | null {
  const body = nestedObject(command.result?.body ? command.result : undefined, "body")
    ?? command.result;
  return isSessionResult(body) ? body : null;
}

function parsePromptSessionResponse(
  command: CloudCommandResponse,
): PromptSessionResponse | null {
  const body = nestedObject(command.result?.body ? command.result : undefined, "body")
    ?? command.result;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const session = nestedObject(body, "session");
  const status = nestedString(body, "status");
  if (!isSessionResult(session) || (status !== "running" && status !== "queued")) {
    return null;
  }
  const queuedSeq = (body as Record<string, unknown>).queuedSeq;
  return {
    session,
    status,
    queuedSeq: typeof queuedSeq === "number" ? queuedSeq : null,
  };
}

function isSessionResult(value: unknown): value is Session {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string"
    && typeof candidate.workspaceId === "string"
    && typeof candidate.agentKind === "string"
    && typeof candidate.status === "string";
}

function commandFailureMessage(command: CloudCommandResponse): string {
  return problemMessage(command.result)
    ?? command.errorMessage
    ?? `Cloud session command ${command.status}.`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function problemMessage(result: Record<string, unknown> | null | undefined): string | null {
  if (!result) {
    return null;
  }
  const problem = nestedObject(result, "body") ?? result;
  const detail = nestedString(problem, "detail")?.trim();
  const title = nestedString(problem, "title")?.trim();
  const message = nestedString(problem, "message")?.trim();
  const code = nestedString(problem, "code")?.trim();
  const baseMessage = detail || message || title;
  if (!baseMessage) {
    return null;
  }
  if (code === "AGENT_AUTH_SELECTION_REQUIRED") {
    return `${baseMessage} Choose a cloud-ready model or configure cloud agent auth.`;
  }
  return baseMessage;
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
