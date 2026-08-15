export function safeRendererErrorName(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return typeof error;
  }
  const value = prototypeDataString(error, "name", 4);
  return value ?? "unknown_error";
}

function prototypeDataString(
  value: object,
  key: PropertyKey,
  maxDepth: number,
): string | null {
  const visited = new Set<object>();
  let current: object | null = value;
  try {
    for (let depth = 0; current !== null && depth < maxDepth; depth += 1) {
      if (visited.has(current)) {
        return null;
      }
      visited.add(current);
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor && "value" in descriptor && typeof descriptor.value === "string") {
        return descriptor.value;
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Stable, low-cardinality failure classes for transport diagnostics. Deliberately
 * derived from error *shape* (name / numeric status) and never from the message
 * text, which can carry request payload or user content.
 */
export type RendererErrorClass =
  | "network"
  | "http_status"
  | "parse"
  | "abort"
  | "unknown";

export function classifyRendererErrorClass(error: unknown): RendererErrorClass {
  if (error === null || error === undefined) {
    return "unknown";
  }
  if (typeof error !== "object") {
    return "unknown";
  }
  if (hasNumericStatus(error)) {
    return "http_status";
  }
  const name = safeRendererErrorName(error);
  if (name === "AbortError") {
    return "abort";
  }
  if (name === "SyntaxError") {
    return "parse";
  }
  // A rejected `fetch` surfaces as a bare TypeError; that is the only network
  // signal the platform gives us without reading the message.
  if (name === "TypeError") {
    return "network";
  }
  return "unknown";
}

function hasNumericStatus(value: object): boolean {
  if (typeof ownNumber(value, "status") === "number") {
    return true;
  }
  const problem = ownRecord(value, "problem");
  return problem !== null && typeof ownNumber(problem, "status") === "number";
}

function ownNumber(value: object, key: PropertyKey): number | null {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor && typeof descriptor.value === "number"
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function ownRecord(value: object, key: PropertyKey): object | null {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor
      && "value" in descriptor
      && typeof descriptor.value === "object"
      && descriptor.value !== null
      ? (descriptor.value as object)
      : null;
  } catch {
    return null;
  }
}

export function safeRendererErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (typeof error !== "object" || error === null) {
    return `[${typeof error}]`;
  }
  return ownString(error, "message") ?? "[no message]";
}

function ownString(value: object, key: PropertyKey): string | null {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor && typeof descriptor.value === "string"
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}
