import { useMemo } from "react";
import type { TranscriptState } from "@anyharness/sdk";
import { deriveActivePlan, type ActivePlan } from "@/lib/domain/chat/active-plan";
import { useHarnessStore } from "@/stores/sessions/harness-store";

export function useActivePlan(): ActivePlan | null {
  const activeSlot = useHarnessStore((state) =>
    state.activeSessionId ? state.sessionSlots[state.activeSessionId] ?? null : null,
  );
  const transcript = activeSlot?.transcript ?? null;

  return useMemo(() => {
    if (!transcript) return null;
    return findActivePlan(transcript);
  }, [transcript]);
}

function findActivePlan(transcript: TranscriptState): ActivePlan | null {
  return deriveActivePlan(transcript);
}
