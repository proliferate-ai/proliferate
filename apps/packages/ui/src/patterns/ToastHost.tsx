import { useSyncExternalStore } from "react";
import { Toaster } from "../primitives/Sonner";
import { ToastDetailsModal } from "./ToastDetailsModal";
import {
  closeToastDetails,
  readToastDetails,
  subscribeToastDetails,
} from "../utils/toast-details-store";

/**
 * The single toast mount: the kit `Toaster` plus the one details modal a
 * `details: { kind: "modal" }` toast opens.
 *
 * Mounting the modal here — rather than letting each caller host its own — is
 * what makes "Details opens the compact modal" a property of the toast system
 * instead of a convention every flow re-implements. Note what is deliberately
 * absent: no notification centre, no toast history. An error that matters after
 * its toast is gone belongs to a surface.
 */
export function ToastHost({
  onReportBug,
}: {
  onReportBug?: (payload: string) => void;
}) {
  const details = useSyncExternalStore(
    subscribeToastDetails,
    readToastDetails,
    readToastDetails,
  );

  return (
    <>
      <Toaster />
      <ToastDetailsModal
        content={details}
        onClose={closeToastDetails}
        onReportBug={onReportBug}
      />
    </>
  );
}
