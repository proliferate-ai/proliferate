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
