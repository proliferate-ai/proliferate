export type WorkspaceFallbackSource = "primary" | "fallback" | "none";

export interface WorkspaceFallbackResult<T> {
  value: T | undefined;
  source: WorkspaceFallbackSource;
  sourceKey: string | null;
  shouldWriteBack: boolean;
}

function hasOwn<T>(
  map: Record<string, T>,
  key: string | null | undefined,
): key is string {
  return key ? Object.prototype.hasOwnProperty.call(map, key) : false;
}

export function resolveWithWorkspaceFallback<T>(
  map: Record<string, T>,
  primaryKey: string | null | undefined,
  fallbackKey: string | null | undefined,
): WorkspaceFallbackResult<T> {
  if (hasOwn(map, primaryKey)) {
    return {
      value: map[primaryKey],
      source: "primary",
      sourceKey: primaryKey,
      shouldWriteBack: false,
    };
  }

  if (primaryKey !== fallbackKey && hasOwn(map, fallbackKey)) {
    return {
      value: map[fallbackKey],
      source: "fallback",
      sourceKey: fallbackKey,
      shouldWriteBack: Boolean(primaryKey),
    };
  }

  return {
    value: undefined,
    source: "none",
    sourceKey: null,
    shouldWriteBack: false,
  };
}

export function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
