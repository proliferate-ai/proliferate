import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  ArrowRight,
  CircleAlert,
  ExternalLink,
  Globe,
  RefreshCw,
} from "@/components/ui/icons";
import type { RightPanelBrowserTab } from "@/lib/domain/workspaces/right-panel";
import {
  browserIframeSandbox,
  normalizeBrowserUrl,
} from "@/lib/domain/workspaces/browser-url";
import {
  browserWebviewLabel,
  closeBrowserWebview,
  ensureBrowserWebview,
  hideBrowserWebview,
  isBrowserWebviewAvailable,
} from "@/platform/tauri/browser-webview";
import { openExternal } from "@/platform/tauri/shell";

interface WorkspaceBrowserPanelProps {
  workspaceId: string | null;
  tabs: readonly RightPanelBrowserTab[];
  activeBrowserId: string | null;
  isVisible: boolean;
  nativeOverlaysHidden?: boolean;
  onUpdateUrl: (browserId: string, url: string) => void;
}

type FrameStatus = "idle" | "loading" | "loaded" | "blocked";

export function WorkspaceBrowserPanel({
  workspaceId,
  tabs,
  activeBrowserId,
  isVisible,
  nativeOverlaysHidden = false,
  onUpdateUrl,
}: WorkspaceBrowserPanelProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const activeTab = tabs.find((tab) => tab.id === activeBrowserId) ?? null;
  const [draftById, setDraftById] = useState<Record<string, string>>({});
  const [statusById, setStatusById] = useState<Record<string, FrameStatus>>({});
  const [reloadNonceById, setReloadNonceById] = useState<Record<string, number>>({});
  const [urlError, setUrlError] = useState(false);
  const nativeWebviewsAvailable = useMemo(() => isBrowserWebviewAvailable(), []);
  useEffect(() => {
    if (browserWebviewDiagnosticLoggingEnabled() && !nativeWebviewsAvailable) {
      console.debug("[browser-webview]", "native unavailable; iframe fallback active");
    }
  }, [nativeWebviewsAvailable]);
  const handleFrameStatusChange = useCallback((tabId: string, status: FrameStatus) => {
    setStatusById((current) => ({ ...current, [tabId]: status }));
  }, []);
  const activeDraft = activeTab
    ? draftById[activeTab.id] ?? activeTab.url ?? ""
    : "";
  const activeStatus = activeTab
    ? statusById[activeTab.id] ?? (activeTab.url ? "loading" : "idle")
    : "idle";

  useEffect(() => {
    if (activeTab?.url !== activeDraft) {
      setUrlError(false);
    }
  }, [activeDraft, activeTab?.url]);

  const reloadTab = useCallback((tabId: string) => {
    setStatusById((current) => ({ ...current, [tabId]: "loading" }));
    setReloadNonceById((current) => ({
      ...current,
      [tabId]: (current[tabId] ?? 0) + 1,
    }));
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeTab) {
      return;
    }
    const normalizedUrl = normalizeBrowserUrl(activeDraft);
    if (!normalizedUrl) {
      setUrlError(true);
      return;
    }
    setUrlError(false);
    setDraftById((current) => ({ ...current, [activeTab.id]: normalizedUrl }));
    if (normalizedUrl === activeTab.url) {
      reloadTab(activeTab.id);
      return;
    }
    setStatusById((current) => ({ ...current, [activeTab.id]: "loading" }));
    onUpdateUrl(activeTab.id, normalizedUrl);
  };

  return (
    <div
      className="flex h-full flex-col bg-sidebar-background text-sidebar-foreground"
      data-telemetry-block
      data-focus-zone="browser"
    >
      <div className="shrink-0 border-b border-sidebar-border bg-sidebar-background">
        <form className="flex h-10 min-w-0 items-center gap-1.5 px-2" onSubmit={handleSubmit}>
          <Tooltip content={activeStatus === "loading" ? "Loading" : "Reload"} singleLine>
            <IconButton
              type="button"
              size="xs"
              tone="sidebar"
              title={activeStatus === "loading" ? "Loading" : "Reload"}
              disabled={!activeTab?.url}
              onClick={() => {
                if (!activeTab) {
                  return;
                }
                reloadTab(activeTab.id);
              }}
            >
              <RefreshCw className={`size-3.5 ${activeStatus === "loading" ? "animate-spin" : ""}`} />
            </IconButton>
          </Tooltip>
          <div className="mx-0.5 h-4 w-px shrink-0 bg-sidebar-border" aria-hidden="true" />
          <div className="relative min-w-0 flex-1">
            <Globe
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sidebar-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={activeDraft}
              disabled={!activeTab}
              placeholder="Enter URL or localhost port"
              className={`h-7 rounded-md border-sidebar-border bg-foreground/5 pl-7 pr-8 text-xs text-sidebar-foreground placeholder:text-sidebar-muted-foreground focus:ring-sidebar-border ${
                urlError ? "border-destructive" : ""
              }`}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={urlError}
              onChange={(event) => {
                if (!activeTab) {
                  return;
                }
                setDraftById((current) => ({
                  ...current,
                  [activeTab.id]: event.target.value,
                }));
              }}
            />
            <IconButton
              type="submit"
              size="xs"
              tone="sidebar"
              title="Navigate"
              disabled={!activeTab || !activeDraft.trim()}
              className="absolute right-1 top-1/2 size-5 -translate-y-1/2"
            >
              <ArrowRight className="size-3.5" />
            </IconButton>
          </div>
          <Tooltip content="Open externally" singleLine>
            <IconButton
              type="button"
              size="xs"
              tone="sidebar"
              title="Open externally"
              disabled={!activeTab?.url}
              onClick={() => {
                if (activeTab?.url) {
                  void openExternal(activeTab.url);
                }
              }}
            >
              <ExternalLink className="size-3.5" />
            </IconButton>
          </Tooltip>
        </form>
        {urlError && (
          <p className="border-t border-sidebar-border px-3 py-1 text-[11px] leading-4 text-sidebar-muted-foreground">
            Enter a valid http or https URL, localhost host, or port.
          </p>
        )}
      </div>

      <div ref={contentRef} className="relative min-h-0 flex-1 overflow-hidden">
        {!activeTab ? (
          <BrowserEmptyState
            title="Browser"
            description="Select a browser tab to preview a local app or website."
          />
        ) : !activeTab.url ? (
          <BrowserEmptyState
            title="Browser"
            description="Enter a URL above. Ports like 3000 open localhost."
          />
        ) : null}

        {tabs.map((tab) =>
          nativeWebviewsAvailable ? (
            <BrowserNativeSurface
              key={`${tab.id}:${reloadNonceById[tab.id] ?? 0}`}
              workspaceId={workspaceId}
              tab={tab}
              active={tab.id === activeBrowserId}
              isPanelVisible={isVisible}
              nativeOverlaysHidden={nativeOverlaysHidden}
              reloadKey={reloadNonceById[tab.id] ?? 0}
              contentRef={contentRef}
              status={statusById[tab.id] ?? (tab.url ? "loading" : "idle")}
              onStatusChange={handleFrameStatusChange}
            />
          ) : (
            <BrowserFrame
              key={`${tab.id}:${reloadNonceById[tab.id] ?? 0}`}
              tab={tab}
              active={isVisible && tab.id === activeBrowserId}
              status={statusById[tab.id] ?? (tab.url ? "loading" : "idle")}
              onStatusChange={handleFrameStatusChange}
            />
          )
        )}
      </div>
    </div>
  );
}

function BrowserNativeSurface({
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
  const label = useMemo(
    () => browserWebviewLabel(workspaceId, tab.id),
    [tab.id, workspaceId],
  );
  const lastLoadKeyRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      void closeBrowserWebview(label);
    };
  }, [label]);

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

function BrowserFrame({
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

function BrowserUnavailableOverlay({
  title,
  description,
  url,
}: {
  title: string;
  description: string;
  url: string;
}) {
  return (
    <div className="pointer-events-auto absolute inset-0 z-10 flex items-center justify-center bg-sidebar-background/95 px-8 backdrop-blur">
      <div className="flex max-w-72 flex-col items-center text-center">
        <div className="mb-4 flex size-11 items-center justify-center rounded-lg border border-sidebar-border bg-foreground/5 text-sidebar-muted-foreground">
          <CircleAlert className="size-5" />
        </div>
        <p className="text-sm font-medium text-sidebar-foreground">
          {title}
        </p>
        <p className="mt-1 text-xs leading-5 text-sidebar-muted-foreground">
          {description}
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-4 h-7 border border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={() => {
            void openExternal(url);
          }}
        >
          <ExternalLink className="size-3.5" />
          Open externally
        </Button>
      </div>
    </div>
  );
}

function BrowserEmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <div className="flex max-w-72 flex-col items-center">
        <div className="mb-4 flex size-12 items-center justify-center rounded-lg border border-sidebar-border bg-foreground/5 text-sidebar-muted-foreground">
          <Globe className="size-6 opacity-70" />
        </div>
        <p className="text-sm font-medium text-sidebar-foreground">{title}</p>
        <p className="mt-1 text-xs leading-5 text-sidebar-muted-foreground">{description}</p>
      </div>
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
