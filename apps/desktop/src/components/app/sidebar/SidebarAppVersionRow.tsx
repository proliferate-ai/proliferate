import { useAppVersion } from "@/hooks/access/tauri/app/use-app-version";

/**
 * Sidebar footer: `Proliferate v{x}`, plus a persistent "Connected to {server}"
 * line when the desktop is pointed at a self-managed server. This is the one
 * always-present place a user can tell which server they are on (the app is
 * otherwise identical across Cloud and self-hosted). Hosted product shows only
 * the version, exactly as before.
 */
export function SidebarAppVersionRow({
  connectedServerName,
}: {
  connectedServerName?: string | null;
}) {
  const { data: appVersion } = useAppVersion();

  return (
    <div className="mt-1 border-t border-border px-2.5 pb-1 pt-2">
      <div className="truncate text-ui-sm text-faint">{`Proliferate v${appVersion ?? "…"}`}</div>
      {connectedServerName ? (
        <div
          className="truncate text-ui-sm text-faint"
          title={connectedServerName}
        >
          {`Connected to ${connectedServerName}`}
        </div>
      ) : null}
    </div>
  );
}
