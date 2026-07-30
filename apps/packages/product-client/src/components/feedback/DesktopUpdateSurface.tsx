import { UpdateRestartDialog } from "#product/components/feedback/UpdateRestartDialog"
import { UpdateToastPresenter } from "#product/components/feedback/UpdateToastPresenter"
import { useAutoUpdateDownload } from "#product/hooks/updates/lifecycle/use-auto-update-download"

/**
 * Everything the desktop app-update flow needs, in one lazy-loadable piece: the
 * restart dialog, the phase toasts, and the automatic background download.
 *
 * Grouped here rather than mounted separately in `App` because they share one
 * precondition — a host with an updater — and because the split let the
 * desktop-only updater and its whole state machine into the public shell, which
 * /login pays for on first load and can never use. `App` decides whether to
 * mount this; nothing in it re-checks.
 */
export function DesktopUpdateSurface() {
  useAutoUpdateDownload()

  return (
    <>
      <UpdateRestartDialog />
      <UpdateToastPresenter />
    </>
  )
}
