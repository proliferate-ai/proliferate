import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { cadence } from "@proliferate/design/cadence";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  markDevDesktopHandoffOpened,
  takeDevDesktopHandoff,
} from "#product/lib/access/cloud/dev-desktop-handoff";
import {
  decodeDesktopProductEntry,
  productEntryRoute,
} from "#product/lib/domain/auth/desktop-navigation";

// Was a raw 1000ms literal; already exactly on-scale, so this is a rename
// onto `cadence.fastMs` rather than a value change (UX Latency + Transitions
// ADR §4.7, Rung 6, Q8).
const DEV_HANDOFF_POLL_MS = cadence.fastMs;
const handledDevHandoffIds = new Set<string>();

// Owns local-dev browser-to-desktop handoffs when OS scheme registration is unavailable.
export function useDevDesktopHandoff() {
  const navigate = useNavigate();
  const { deployment, desktop } = useProductHost();
  const nativeUi = desktop?.nativeUi ?? null;
  const apiBaseUrl = deployment.apiBaseUrl;

  useEffect(() => {
    if (!import.meta.env.DEV || !nativeUi?.isMainWebviewAvailable()) {
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
      void takeDevDesktopHandoff(apiBaseUrl, abortController.signal)
        .then((handoff) => {
          if (!handoff || cancelled) {
            return;
          }
          if (handledDevHandoffIds.has(handoff.id)) {
            return;
          }
          handledDevHandoffIds.add(handoff.id);
          const entry = decodeDesktopProductEntry(handoff.url);
          const target = entry ? productEntryRoute(entry) : null;
          if (target) {
            navigate(target);
            void markDevDesktopHandoffOpened(apiBaseUrl, handoff.id).catch(() => {
              // The route already opened; the browser retry state is dev-only feedback.
            });
            void nativeUi?.revealCurrentWindow().catch(() => {
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
  }, [navigate, nativeUi, apiBaseUrl]);
}
