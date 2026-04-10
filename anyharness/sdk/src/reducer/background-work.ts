export type ToolBackgroundWorkTrackerKind = "claude_async_agent";
export type ToolBackgroundWorkState = "pending" | "completed" | "expired";

export interface ToolBackgroundWorkMetadata {
  trackerKind: ToolBackgroundWorkTrackerKind;
  state: ToolBackgroundWorkState;
  isAsync: boolean;
  agentId: string | null;
  outputFile: string | null;
}

export function parseToolBackgroundWork(
  rawOutput: unknown,
): ToolBackgroundWorkMetadata | null {
  if (!isRecord(rawOutput)) {
    return null;
  }

  const backgroundWork = isRecord(rawOutput._anyharness)
    ? rawOutput._anyharness.backgroundWork
    : null;
  if (!isRecord(backgroundWork)) {
    return null;
  }

  const trackerKind = readTrackerKind(backgroundWork.trackerKind);
  const state = readState(backgroundWork.state);
  if (!trackerKind || !state) {
    return null;
  }

  return {
    trackerKind,
    state,
    isAsync: rawOutput.isAsync === true,
    agentId: readString(rawOutput.agentId),
    outputFile: readString(rawOutput.outputFile),
  };
}

function readTrackerKind(
  value: unknown,
): ToolBackgroundWorkTrackerKind | null {
  return value === "claude_async_agent" ? value : null;
}

function readState(value: unknown): ToolBackgroundWorkState | null {
  return value === "pending" || value === "completed" || value === "expired"
    ? value
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
