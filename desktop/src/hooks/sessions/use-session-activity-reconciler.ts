import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { collectSessionActivityReconciliationIds } from "@/lib/domain/sessions/activity";
import { isPendingSessionId } from "@/lib/integrations/anyharness/session-runtime";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";

const ACTIVITY_RECONCILE_DELAY_MS = 5_000;

export function useSessionActivityReconciler() {
  const { refreshSessionSlotMeta } = useSessionRuntimeActions();
  const activeSessionIds = useHarnessStore(useShallow((state) =>
    collectSessionActivityReconciliationIds(state.sessionSlots)
      .filter((sessionId) => !isPendingSessionId(sessionId))
  ));

  useEffect(() => {
    if (activeSessionIds.length === 0) {
      return;
    }

    let cancelled = false;
    let refreshInFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = (delayMs = ACTIVITY_RECONCILE_DELAY_MS) => {
      if (cancelled) {
        return;
      }
      timer = setTimeout(runRefresh, delayMs);
    };

    const runRefresh = () => {
      timer = null;
      if (cancelled) {
        return;
      }
      if (refreshInFlight) {
        scheduleRefresh();
        return;
      }

      refreshInFlight = true;
      void Promise.allSettled(
        activeSessionIds.map((sessionId) =>
          refreshSessionSlotMeta(sessionId, { resumeIfActive: false })
        ),
      ).finally(() => {
        refreshInFlight = false;
        scheduleRefresh();
      });
    };

    scheduleRefresh(0);

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [activeSessionIds, refreshSessionSlotMeta]);
}
