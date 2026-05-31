import { useCallback, useEffect } from "react";
import { openSupportReportWindow } from "@/lib/access/tauri/support";
import { subscribeSupportDialogRequest } from "@/lib/infra/support/support-dialog-request";
import { useToastStore } from "@/stores/toast/toast-store";
import type { SupportMessageContext } from "@/lib/domain/support/types";
import { useSupportReportSnapshot } from "@/hooks/support/derived/use-support-report-snapshot";

interface UseOpenSupportReportWindowOptions {
  source: SupportMessageContext["source"];
  subscribeToRequests?: boolean;
}

export function useOpenSupportReportWindow({
  source,
  subscribeToRequests = true,
}: UseOpenSupportReportWindowOptions) {
  const supportSnapshot = useSupportReportSnapshot({ source });
  const showToast = useToastStore((state) => state.show);

  const handleOpenSupport = useCallback(() => {
    void openSupportReportWindow(supportSnapshot).catch((error) => {
      const message = error instanceof Error ? error.message : "Failed to open support.";
      showToast(message);
    });
  }, [showToast, supportSnapshot]);

  useEffect(() => {
    if (!subscribeToRequests) {
      return undefined;
    }
    return subscribeSupportDialogRequest(handleOpenSupport);
  }, [handleOpenSupport, subscribeToRequests]);

  return handleOpenSupport;
}
