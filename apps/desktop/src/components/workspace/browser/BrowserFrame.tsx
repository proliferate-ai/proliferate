import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { RightPanelBrowserTab } from "@/lib/domain/workspaces/shell/right-panel-model";
import { browserIframeSandbox } from "@/lib/domain/workspaces/shell/browser-url";
import { BrowserUnavailableOverlay } from "./BrowserFallbackStates";
import type { FrameStatus } from "./BrowserPanelTypes";

export function BrowserFrame({
  tab,
  active,
  status,
  onStatusChange,
}: {
  tab: RightPanelBrowserTab;
  active: boolean;
  status: FrameStatus;
  onStatusChange: (tabId: string, status: FrameStatus) => void;
}) {
  const appOrigin = typeof window === "undefined" ? "" : window.location.origin;
  const sandbox = useMemo(
    () => tab.url ? browserIframeSandbox(tab.url, appOrigin) : "allow-scripts allow-forms",
    [appOrigin, tab.url],
  );
  const timeoutRef = useRef<number | null>(null);

  const clearFrameTimeout = useCallback(() => {
    if (timeoutRef.current === null) {
      return;
    }
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  useEffect(() => {
    clearFrameTimeout();
    if (!tab.url) {
      onStatusChange(tab.id, "idle");
      return;
    }
    onStatusChange(tab.id, "loading");
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      onStatusChange(tab.id, "blocked");
    }, 10_000);
    return clearFrameTimeout;
  }, [clearFrameTimeout, onStatusChange, tab.id, tab.url]);

  if (!tab.url) {
    return null;
  }

  return (
    <div
      className={active ? "absolute inset-0" : "hidden pointer-events-none"}
      aria-hidden={!active}
      tabIndex={active ? undefined : -1}
    >
      {status === "blocked" && active && (
        <BrowserUnavailableOverlay
          title="This site may block embedding."
          description="The tab stays editable. Open it externally if the preview does not load."
          url={tab.url}
        />
      )}
      <iframe
        src={tab.url}
        title="Browser preview"
        sandbox={sandbox}
        referrerPolicy="no-referrer"
        allow=""
        className="h-full w-full border-0 bg-background"
        onLoad={() => {
          clearFrameTimeout();
          onStatusChange(tab.id, "loaded");
        }}
        onError={() => {
          clearFrameTimeout();
          onStatusChange(tab.id, "blocked");
        }}
      />
    </div>
  );
}
