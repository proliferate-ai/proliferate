import type { ContentPart } from "@anyharness/sdk";
import type { SessionDebugExportedSession } from "#product/lib/domain/support/session-debug/export-models";
import {
  isRedactedObjectKey,
  isSafeObjectKey,
  isSafeTypeValue,
} from "#product/lib/domain/support/session-debug/sanitizer-shape";
import {
  sessionDebugArrayElementNode,
  sessionDebugChildNode,
} from "#product/lib/domain/support/session-debug/primitive-contracts";
import {
  sessionDebugPrimitiveKind,
  type SessionDebugPrimitiveKind,
  type SessionDebugSchemaNode,
} from "#product/lib/domain/support/session-debug/primitive-policy";

const MAX_SANITIZER_DEPTH = 16;
const MAX_CONTAINER_ITEMS = 256;
const MAX_SANITIZED_VALUES = 10_000;
interface SanitizerContext {
  remainingValues: number;
  activeContainers: WeakSet<object>;
}

export function sanitizeSessionDebugExportedSession(
  session: SessionDebugExportedSession,
): SessionDebugExportedSession {
  return sanitizeSessionDebugValue(
    session,
    "",
    "exportedSession",
    createContext(),
  ) as SessionDebugExportedSession;
}

export function sanitizeSessionDebugContentParts(parts: ContentPart[]): ContentPart[] {
  return sanitizeSessionDebugValue(
    parts,
    "contentParts",
    "contentPartList",
    createContext(),
  ) as ContentPart[];
}

function sanitizeSessionDebugValue(
  value: unknown,
  keyHint: string,
  schemaNode: SessionDebugSchemaNode,
  context: SanitizerContext,
  depth = 0,
  primitiveKind?: SessionDebugPrimitiveKind,
): unknown {
  if (!consumeBudget(context)) {
    return redactedMarker();
  }
  if (value == null) {
    return value;
  }
  if (primitiveKind === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : redactedMarker();
  }
  if (primitiveKind === "boolean") {
    return typeof value === "boolean" ? value : redactedMarker();
  }
  if (typeof value === "number") {
    return redactedMarker();
  }
  if (typeof value === "boolean") {
    return redactedMarker();
  }
  if (typeof value === "string") {
    return keyHint === "type" && isSafeTypeValue(value)
      ? value
      : `[redacted:${value.length}]`;
  }
  if (typeof value !== "object") {
    return redactedMarker();
  }
  if (isRedactedObjectKey(keyHint)) {
    return redactedMarker();
  }
  if (depth >= MAX_SANITIZER_DEPTH || context.activeContainers.has(value)) {
    return redactedMarker();
  }
  context.activeContainers.add(value);
  try {
    if (isArraySafely(value)) {
      return sanitizeArray(value, schemaNode, context, depth);
    }

    return sanitizeObject(value, schemaNode, context, depth);
  } finally {
    context.activeContainers.delete(value);
  }
}

function sanitizeArray(
  value: unknown[],
  schemaNode: SessionDebugSchemaNode,
  context: SanitizerContext,
  depth: number,
): unknown[] {
  const output: unknown[] = [];
  let itemCount: number;
  try {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor
      || !("value" in lengthDescriptor)
      || typeof lengthDescriptor.value !== "number"
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0
    ) {
      return consumeBudget(context) ? [redactedMarker()] : output;
    }
    itemCount = Math.min(lengthDescriptor.value, MAX_CONTAINER_ITEMS);
  } catch {
    return consumeBudget(context) ? [redactedMarker()] : output;
  }
  const elementNode = sessionDebugArrayElementNode(schemaNode);
  for (let index = 0; index < itemCount && context.remainingValues > 0; index += 1) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) {
        if (consumeBudget(context)) {
          output.push(redactedMarker());
        }
        continue;
      }
      output.push(sanitizeSessionDebugValue(
        descriptor.value,
        "",
        elementNode,
        context,
        depth + 1,
      ));
    } catch {
      if (consumeBudget(context)) {
        output.push(redactedMarker());
      }
    }
  }
  return output;
}

function sanitizeObject(
  value: object,
  schemaNode: SessionDebugSchemaNode,
  context: SanitizerContext,
  depth: number,
): Record<string, unknown> | { redacted: true } {
  const output: Record<string, unknown> = {};
  let redactedKeyIndex = 0;
  let enumeratedKeys = 0;
  try {
    for (const key in value as Record<string, unknown>) {
      if (enumeratedKeys >= MAX_CONTAINER_ITEMS || context.remainingValues <= 0) {
        break;
      }
      enumeratedKeys += 1;
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        continue;
      }

      if (!isSafeObjectKey(key)) {
        if (!consumeBudget(context)) {
          break;
        }
        output[`[redacted-key:${key.length}:${redactedKeyIndex++}]`] = redactedMarker();
        continue;
      }

      if (isRedactedObjectKey(key)) {
        if (!consumeBudget(context)) {
          break;
        }
        output[key] = redactedMarker();
        continue;
      }

      try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor)) {
          if (consumeBudget(context)) {
            output[key] = redactedMarker();
          }
          continue;
        }
        output[key] = sanitizeSessionDebugValue(
          descriptor.value,
          key,
          sessionDebugChildNode(schemaNode, key, value),
          context,
          depth + 1,
          sessionDebugPrimitiveKind(schemaNode, key, value),
        );
      } catch {
        if (consumeBudget(context)) {
          output[key] = redactedMarker();
        }
      }
    }
  } catch {
    return redactedMarker();
  }
  return output;
}

function createContext(): SanitizerContext {
  return {
    remainingValues: MAX_SANITIZED_VALUES,
    activeContainers: new WeakSet<object>(),
  };
}

function consumeBudget(context: SanitizerContext): boolean {
  if (context.remainingValues <= 0) {
    return false;
  }
  context.remainingValues -= 1;
  return true;
}

function redactedMarker(): { redacted: true } {
  return { redacted: true };
}

function isArraySafely(value: unknown): value is unknown[] {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}
