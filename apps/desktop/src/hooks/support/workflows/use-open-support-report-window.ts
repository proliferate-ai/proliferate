import { useCallback } from "react";
import { useSupportModalStore } from "@/stores/support/support-modal-store";
import type { SupportMessageContext } from "@/lib/domain/support/types";

interface UseOpenSupportReportWindowOptions {
  source: SupportMessageContext["source"];
}

export function useOpenSupportReportWindow({
  source: _source,
}: UseOpenSupportReportWindowOptions) {
  const openFeedback = useSupportModalStore((state) => state.openFeedback);

  return useCallback(() => {
    openFeedback();
  }, [openFeedback]);
}
