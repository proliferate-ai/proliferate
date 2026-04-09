import { useEffect, useState } from "react";
import { isSessionSlotBusy } from "@/lib/domain/sessions/activity";
import {
  hideCurrentWindow,
  listenForCurrentWindowCloseRequested,
  quitDesktopApp,
} from "@/platform/tauri/window";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";

interface AppCloseGuardState {
  closeDialogOpen: boolean;
  runningAgentCount: number;
  isQuitting: boolean;
  closeDialog: () => void;
  hideWindow: () => Promise<void>;
  quitApp: () => Promise<void>;
}

export function useAppCloseGuard(): AppCloseGuardState {
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const runningAgentCount = useHarnessStore((state) =>
    Object.values(state.sessionSlots).filter((slot) => isSessionSlotBusy(slot)).length
  );
  const showToast = useToastStore((state) => state.show);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};

    void listenForCurrentWindowCloseRequested((event) => {
      event.preventDefault();
      setCloseDialogOpen(true);
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    });

    return () => {
      disposed = true;
      unlisten();
    };
  }, []);

  async function hideWindow() {
    try {
      await hideCurrentWindow();
      setCloseDialogOpen(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to hide window.");
    }
  }

  async function quitApp() {
    try {
      setIsQuitting(true);
      await quitDesktopApp();
      setCloseDialogOpen(false);
      setIsQuitting(false);
    } catch (error) {
      setIsQuitting(false);
      showToast(error instanceof Error ? error.message : "Failed to quit Proliferate.");
    }
  }

  return {
    closeDialogOpen,
    runningAgentCount,
    isQuitting,
    closeDialog: () => setCloseDialogOpen(false),
    hideWindow,
    quitApp,
  };
}
