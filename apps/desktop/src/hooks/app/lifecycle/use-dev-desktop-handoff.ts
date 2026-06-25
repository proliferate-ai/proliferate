import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { takeDevDesktopHandoff } from "@/lib/access/cloud/dev-desktop-handoff";
import {
  isMainTauriWebviewAvailable,
  revealCurrentWindow,
} from "@/lib/access/tauri/window";
import { desktopNavigationTarget } from "@/lib/domain/auth/desktop-navigation";

const DEV_HANDOFF_POLL_MS = 1000;
const handledDevHandoffIds = new Set<string>();

// Owns local-dev browser-to-desktop handoffs when OS scheme registration is unavailable.
export function useDevDesktopHandoff() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!import.meta.env.DEV || !isMainTauriWebviewAvailable()) {
      return;
    }

    let cancelled = false;
    let polling = false;
    let timeoutId: number | null = null;
    let abortController: AbortController | null = null;

    const scheduleNextPoll = () => {
      if (cancelled) {
        return;
      }
      timeoutId = window.setTimeout(runPoll, DEV_HANDOFF_POLL_MS);
    };

    const runPoll = () => {
      if (cancelled || polling) {
        return;
      }
      polling = true;
      abortController = new AbortController();
      void takeDevDesktopHandoff(abortController.signal)
        .then((handoff) => {
          if (!handoff || cancelled) {
            return;
          }
          if (handledDevHandoffIds.has(handoff.id)) {
            return;
          }
          handledDevHandoffIds.add(handoff.id);
          const target = desktopNavigationTarget(handoff.url);
          if (target) {
            navigate(target);
            void revealCurrentWindow().catch(() => {
              // The handoff should still navigate if the OS refuses focus.
            });
          }
        })
        .catch(() => {
          // The local API may restart during development; retry quietly.
        })
        .finally(() => {
          polling = false;
          abortController = null;
          scheduleNextPoll();
        });
    };

    runPoll();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      abortController?.abort();
    };
  }, [navigate]);
}
