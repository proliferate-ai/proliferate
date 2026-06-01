import type { CloudCommandResponse } from "@proliferate/cloud-sdk";

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

export function nestedString(value: unknown, key: string): string | null {
  const object = objectFromUnknown(value);
  if (!object) return null;
  const nested = object[key];
  return typeof nested === "string" ? nested : null;
}

function commandResultObject(command: CloudCommandResponse): Record<string, unknown> | null {
  return objectFromUnknown(command.result);
}

function commandResultBodyObject(command: CloudCommandResponse): Record<string, unknown> | null {
  const result = commandResultObject(command);
  return objectFromUnknown(result?.body);
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
