import type {
  SessionEventEnvelope,
  SessionRawNotificationEnvelope,
} from "../types/events.js";
import { normalizeSession } from "../types/sessions.js";

type GeneratedSession = Parameters<typeof normalizeSession>[0];

const SESSION_FIELDS = new Set([
  "actionCapabilities",
  "activeGoal",
  "activity",
  "agentKind",
  "closedAt",
  "createdAt",
  "dismissedAt",
  "executionSummary",
  "id",
  "lastPromptAt",
  "liveConfig",
  "mcpBindingSummaries",
  "modeId",
  "modelId",
  "nativeSessionId",
  "origin",
  "pendingPrompts",
  "requestedModeId",
  "requestedModelId",
  "status",
  "title",
  "updatedAt",
  "workspaceId",
]);
const EVENT_FIELDS = new Set([
  "event",
  "itemId",
  "seq",
  "sessionId",
  "timestamp",
  "turnId",
]);
const RAW_NOTIFICATION_FIELDS = new Set([
  "notification",
  "notificationKind",
  "seq",
  "sessionId",
  "timestamp",
]);

export function validateSupportSessionItem(
  value: Record<string, unknown>,
): GeneratedSession {
  assertAllowedFields(value, SESSION_FIELDS, "session item");
  requireString(value, "agentKind", "session item");
  requireString(value, "createdAt", "session item");
  requireString(value, "id", "session item");
  requireString(value, "status", "session item");
  requireString(value, "updatedAt", "session item");
  requireString(value, "workspaceId", "session item");
  optionalObject(value, "actionCapabilities", false, "session item");
  optionalObject(value, "liveConfig", true, "session item");
  return value as unknown as GeneratedSession;
}

export function validateSupportEventItem(
  value: Record<string, unknown>,
): SessionEventEnvelope {
  assertAllowedFields(value, EVENT_FIELDS, "event item");
  requireString(value, "sessionId", "event item");
  requireString(value, "timestamp", "event item");
  requirePositiveSequence(value, "event item");
  optionalString(value, "turnId", "event item");
  optionalString(value, "itemId", "event item");
  const event = value.event;
  if (!isPlainRecord(event) || typeof event.type !== "string") {
    throw invalidItem("event item.event is invalid");
  }
  return value as unknown as SessionEventEnvelope;
}

export function validateSupportRawNotificationItem(
  value: Record<string, unknown>,
): SessionRawNotificationEnvelope {
  assertAllowedFields(value, RAW_NOTIFICATION_FIELDS, "raw notification item");
  requireString(value, "sessionId", "raw notification item");
  requireString(value, "timestamp", "raw notification item");
  requireString(value, "notificationKind", "raw notification item");
  requirePositiveSequence(value, "raw notification item");
  if (!Object.prototype.hasOwnProperty.call(value, "notification")) {
    throw invalidItem("raw notification item.notification is missing");
  }
  return value as unknown as SessionRawNotificationEnvelope;
}

function assertAllowedFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const keys = Object.keys(value);
  for (let index = 0; index < keys.length; index += 1) {
    if (!allowed.has(keys[index])) {
      throw invalidItem(`${label} contains an incompatible field`);
    }
  }
}

function requireString(
  value: Record<string, unknown>,
  property: string,
  label: string,
): void {
  if (typeof value[property] !== "string") {
    throw invalidItem(`${label}.${property} must be a string`);
  }
}

function optionalString(
  value: Record<string, unknown>,
  property: string,
  label: string,
): void {
  const field = value[property];
  if (field !== undefined && field !== null && typeof field !== "string") {
    throw invalidItem(`${label}.${property} must be a string or null`);
  }
}

function optionalObject(
  value: Record<string, unknown>,
  property: string,
  allowNull: boolean,
  label: string,
): void {
  const field = value[property];
  if (
    field !== undefined
    && !(allowNull && field === null)
    && !isPlainRecord(field)
  ) {
    throw invalidItem(`${label}.${property} must be an object`);
  }
}

function requirePositiveSequence(
  value: Record<string, unknown>,
  label: string,
): void {
  if (!Number.isSafeInteger(value.seq) || (value.seq as number) < 1) {
    throw invalidItem(`${label}.seq must be a positive safe integer`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function invalidItem(message: string): TypeError {
  return new TypeError(`Invalid support-window response: ${message}`);
}
