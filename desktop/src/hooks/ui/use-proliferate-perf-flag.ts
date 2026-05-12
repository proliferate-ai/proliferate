import { useSyncExternalStore } from "react";
import {
  isProliferatePerfFlagEnabled,
  subscribeProliferatePerfFlags,
  type ProliferatePerfFlagName,
} from "@/lib/infra/perf/perf-isolation-flags";

export function useProliferatePerfFlag(flag: ProliferatePerfFlagName): boolean {
  return useSyncExternalStore(
    subscribeProliferatePerfFlags,
    () => isProliferatePerfFlagEnabled(flag),
    () => false,
  );
}
