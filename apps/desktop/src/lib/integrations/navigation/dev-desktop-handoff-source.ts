import type { ProductEntry } from "@proliferate/product-client/host/product-host";
import {
  markDevDesktopHandoffOpened,
  takeDevDesktopHandoff,
} from "@/lib/access/cloud/dev-desktop-handoff";
import {
  isMainTauriWebviewAvailable,
  revealCurrentWindow,
} from "@/lib/access/tauri/window";
import { decodeDesktopProductEntry } from "@/lib/domain/auth/desktop-navigation";

const DEV_HANDOFF_POLL_MS = 1000;
const handledDevHandoffIds = new Set<string>();

/**
 * Adds the dev-only browser-to-Desktop fallback to ProductLinks' one inbound
 * entry source. It decodes host URLs but never routes or navigates; the shared
 * product-entry observer remains the sole routing owner.
 */
export function subscribeDevDesktopHandoffs(
  apiBaseUrl: string,
  listener: (entry: ProductEntry) => void,
): () => void {
  if (!import.meta.env.DEV || !isMainTauriWebviewAvailable()) {
    return () => {};
  }

  let cancelled = false;
  let polling = false;
  let timeoutId: number | null = null;
  let abortController: AbortController | null = null;

  const scheduleNextPoll = () => {
    if (!cancelled) {
      timeoutId = window.setTimeout(runPoll, DEV_HANDOFF_POLL_MS);
    }
  };

  const runPoll = () => {
    if (cancelled || polling) {
      return;
    }
    polling = true;
    abortController = new AbortController();
    void takeDevDesktopHandoff(apiBaseUrl, abortController.signal)
      .then((handoff) => {
        if (!handoff || cancelled || handledDevHandoffIds.has(handoff.id)) {
          return;
        }
        handledDevHandoffIds.add(handoff.id);
        const entry = decodeDesktopProductEntry(handoff.url);
        if (entry === null) {
          return;
        }
        listener(entry);
        void markDevDesktopHandoffOpened(apiBaseUrl, handoff.id).catch(() => {
          // Delivery already completed; this endpoint is dev-only feedback.
        });
        void revealCurrentWindow().catch(() => {
          // Entry delivery remains valid if the OS refuses to focus Desktop.
        });
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
}
