import type { SetStateAction } from "react";

export function resolveStateValue<T>(value: SetStateAction<T>, current: T): T {
  return typeof value === "function"
    ? (value as (previousValue: T) => T)(current)
    : value;
}
