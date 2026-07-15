import { WifiOff } from "lucide-react";
import { useConnectivityStore } from "@/stores/infra/connectivity-store";

/**
 * Persistent banner when the app is offline. Auto-hides on reconnect.
 * Placed at the top of the workspace shell so it is always visible.
 */
export function OfflineIndicator() {
  const isOnline = useConnectivityStore((state) => state.isOnline);

  if (isOnline) {
    return null;
  }

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-warning/40 bg-warning px-3 py-1.5 text-sm font-medium text-warning-foreground"
    >
      <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
      No internet connection — local work is safe; agents need a connection.
    </div>
  );
}
