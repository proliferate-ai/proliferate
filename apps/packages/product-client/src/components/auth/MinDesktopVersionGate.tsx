import { Button } from "#product/primitives/Button";
import { AlertTriangle } from "#product/primitives/icons/status";
import { RefreshCw } from "#product/primitives/icons/platform";
import { useMinDesktopVersionGate } from "#product/hooks/access/cloud/server-capabilities/use-min-desktop-version-gate";
import { useUpdater } from "#product/hooks/access/tauri/use-updater";
import { useAppSidebarSignOutAction } from "#product/hooks/app/workflows/use-app-sidebar-sign-out-action";

/**
 * Full-screen takeover blocking a desktop below the connected server's
 * enforced `minDesktopVersion`. Clones `BootstrappedRoute`'s gating pattern
 * (fixed inset-0 z-50 above the workspace outlet) rather than a dismissible
 * modal, because this is a hard requirement, not a nag — the ADR ruling for
 * FR-4 is a blocking screen, not a toast the user can defer indefinitely.
 *
 * Mounted in `App.tsx` above the `BootstrappedRoute` outlet. Renders nothing
 * until `useMinDesktopVersionGate` resolves a definite answer, and renders
 * nothing when the server never opted into enforcement or doesn't declare a
 * well-formed `/meta` (self-hosted servers included) — see that hook and
 * `fetchMinDesktopVersionGate` for the fail-open conditions.
 */
export function MinDesktopVersionGate() {
  const gate = useMinDesktopVersionGate();
  const { checkNow } = useUpdater();
  const signOut = useAppSidebarSignOutAction();

  if (!gate || !gate.blocked) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="w-full max-w-[420px] px-6 text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-lg border border-border/70 bg-surface-elevated-secondary">
          <AlertTriangle className="icon-paired text-special" />
        </span>
        <h1 className="mt-4 text-title text-foreground">Update required to continue</h1>
        <p className="mt-2 text-ui text-muted-foreground">
          This desktop is on version {gate.appVersion}. The connected server requires{" "}
          {gate.minDesktopVersion} or later.
        </p>
        <Button
          variant="primary"
          size="sm"
          className="mt-5"
          onClick={() => void checkNow()}
        >
          <RefreshCw className="icon-paired" />
          Check for update
        </Button>
        {/* Escape hatch: "Check for update" drives the vendor updater feed,
            which a self-hosted floor may never be satisfiable against. Signing
            out returns to the connect surface (which this gate never covers),
            so the user can point the app at a different server. */}
        <div className="mt-3">
          <Button variant="ghost" size="sm" onClick={signOut}>
            Sign out and switch server
          </Button>
        </div>
      </div>
    </div>
  );
}
