import { useRef } from "react";
import { sameStringArray } from "@/lib/domain/workspaces/selection/workspace-keyed-preferences";

export function useStableStringArray<T extends readonly string[]>(value: T): T {
  const previousRef = useRef<T | null>(null);
  const previous = previousRef.current;
  if (previous && sameStringArray(previous, value)) {
    return previous;
  }
  previousRef.current = value;
  return value;
}
