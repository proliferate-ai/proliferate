import { useCallback } from "react";
import { useSupportModalStore } from "@/stores/support/support-modal-store";
import { useSupportAvailability } from "@/hooks/support/facade/use-support-availability";
import { useToastStore } from "@/stores/toast/toast-store";
import type { SupportMessageContext } from "@/lib/domain/support/types";

interface UseOpenSupportReportWindowOptions {
  source: SupportMessageContext["source"];
}

/**
 * Gated openers for the support modals. Opening is only allowed with a real
 * Cloud session — otherwise we surface the reason instead of opening a modal
 * whose report could never upload. Entry points should also disable their
 * trigger via `useSupportAvailability().disabledReason`; this guard is the
 * defensive floor for any path that can't (e.g. keyboard shortcuts).
 */
export function useOpenSupportReportWindow({
  source: _source,
}: UseOpenSupportReportWindowOptions) {
  const openFeedback = useSupportModalStore((state) => state.openFeedback);
  const openPrompt = useSupportModalStore((state) => state.openPrompt);
  const { canSubmit, disabledReason } = useSupportAvailability();
  const showToast = useToastStore((state) => state.show);

  const openBug = useCallback(() => {
    if (!canSubmit) {
      if (disabledReason) {
        showToast(disabledReason);
      }
      return;
    }
    openFeedback();
  }, [canSubmit, disabledReason, openFeedback, showToast]);

  const openFeature = useCallback(() => {
    if (!canSubmit) {
      if (disabledReason) {
        showToast(disabledReason);
      }
      return;
    }
    openPrompt();
  }, [canSubmit, disabledReason, openPrompt, showToast]);

  return { openBug, openFeature, canSubmit, disabledReason };
}
