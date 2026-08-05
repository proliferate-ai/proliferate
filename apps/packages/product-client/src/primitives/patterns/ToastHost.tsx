import { lazy, Suspense, useSyncExternalStore } from "react";
import { Toaster } from "#product/primitives/Sonner";
import {
  closeToastDetails,
  readToastDetails,
  subscribeToastDetails,
} from "#product/primitives/utils/toast-details-store";

/**
 * Loaded on the click, not on the load. The modal cannot appear until someone
 * presses Details, so the shell it drags in — `ModalShell` and `Button` — has
 * no business in the first paint; /login in particular renders this host and
 * can never open it. `Suspense fallback={null}` is honest here: there is
 * nothing to show while the chunk arrives, because nothing was open yet.
 */
const ToastDetailsModal = lazy(() =>
  import("./ToastDetailsModal").then((module) => ({ default: module.ToastDetailsModal })),
);

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
      {details === null ? null : (
        <Suspense fallback={null}>
          <ToastDetailsModal
            content={details}
            onClose={closeToastDetails}
            onReportBug={onReportBug}
          />
        </Suspense>
      )}
    </>
  );
}
