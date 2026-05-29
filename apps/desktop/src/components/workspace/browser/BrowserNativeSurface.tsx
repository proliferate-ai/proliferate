import {
  useEffect,
  useMemo,
  useRef,
  type RefObject,
} from "react";
import { useTauriBrowserWebviewActions } from "@/hooks/access/tauri/use-browser-webview-actions";
import type { RightPanelBrowserTab } from "@/lib/domain/workspaces/shell/right-panel-model";
import { BrowserUnavailableOverlay } from "./BrowserFallbackStates";
import type { FrameStatus } from "./BrowserPanelTypes";

export function BrowserNativeSurface({
  workspaceId,
  tab,
  active,
  isPanelVisible,
  nativeOverlaysHidden,
  reloadKey,
  contentRef,
  status,
  onStatusChange,
}: {
  workspaceId: string | null;
  tab: RightPanelBrowserTab;
  active: boolean;
  isPanelVisible: boolean;
  nativeOverlaysHidden: boolean;
  reloadKey: number;
  contentRef: RefObject<HTMLDivElement | null>;
  status: FrameStatus;
  onStatusChange: (tabId: string, status: FrameStatus) => void;
}) {
  const {
    browserWebviewLabel,
    closeBrowserWebview,
    ensureBrowserWebview,
    hideBrowserWebview,
  } = useTauriBrowserWebviewActions();
  const label = useMemo(
    () => browserWebviewLabel(workspaceId, tab.id),
    [browserWebviewLabel, tab.id, workspaceId],
  );
  const lastLoadKeyRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      void closeBrowserWebview(label);
    };
  }, [closeBrowserWebview, label]);

  useEffect(() => {
    if (!tab.url) {
      lastLoadKeyRef.current = null;
      onStatusChange(tab.id, "idle");
      void closeBrowserWebview(label);
      return;
    }

    if (!active || !isPanelVisible || nativeOverlaysHidden) {
      void hideBrowserWebview(label);
      return;
    }

    let canceled = false;
    const loadKey = `${tab.url}:${reloadKey}`;
    const syncWebview = () => {
      if (canceled || !tab.url) {
        return;
      }
      const bounds = browserWebviewBoundsFromElement(contentRef.current);
      if (!bounds) {
        void hideBrowserWebview(label);
        return;
      }
      if (lastLoadKeyRef.current !== loadKey) {
        lastLoadKeyRef.current = loadKey;
        onStatusChange(tab.id, "loading");
      }
      void ensureBrowserWebview({
        label,
        url: tab.url,
        bounds,
        visible: true,
        reloadKey,
      })
        .then(() => {
          if (!canceled) {
            onStatusChange(tab.id, "loaded");
          }
        })
        .catch(() => {
          if (!canceled) {
            void hideBrowserWebview(label);
            if (browserWebviewDiagnosticLoggingEnabled()) {
              console.debug("[browser-webview]", "native failed", {
                label,
              });
            }
            onStatusChange(tab.id, "blocked");
          }
        });
    };

    syncWebview();
    return observeBrowserViewport(contentRef.current, syncWebview, () => {
      canceled = true;
    });
  }, [
    active,
    contentRef,
    closeBrowserWebview,
    ensureBrowserWebview,
    hideBrowserWebview,
    isPanelVisible,
    label,
    nativeOverlaysHidden,
    onStatusChange,
    reloadKey,
    tab.id,
    tab.url,
  ]);

  if (!tab.url) {
    return null;
  }

  return (
    <div
      className={active ? "pointer-events-none absolute inset-0" : "hidden pointer-events-none"}
      aria-hidden={!active}
      tabIndex={active ? undefined : -1}
    >
      {status === "blocked" && active && (
        <BrowserUnavailableOverlay
          title="This page could not be opened."
          description="The tab stays editable. Open it externally or try another URL."
          url={tab.url}
        />
      )}
    </div>
  );
}

function browserWebviewBoundsFromElement(element: HTMLElement | null) {
  if (!element) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (width < 2 || height < 2) {
    return null;
  }
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width,
    height,
  };
}

function observeBrowserViewport(
  element: HTMLElement | null,
  onChange: () => void,
  onCleanup: () => void,
): () => void {
  let resizeObserver: ResizeObserver | null = null;
  if (element && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(onChange);
    resizeObserver.observe(element);
  }
  window.addEventListener("resize", onChange);
  window.addEventListener("scroll", onChange, true);
  return () => {
    onCleanup();
    resizeObserver?.disconnect();
    window.removeEventListener("resize", onChange);
    window.removeEventListener("scroll", onChange, true);
  };
}

function browserWebviewDiagnosticLoggingEnabled(): boolean {
  return import.meta.env.DEV && import.meta.env.MODE !== "test";
}
