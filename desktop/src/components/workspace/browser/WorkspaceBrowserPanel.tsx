import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { RightPanelBrowserTab } from "@/lib/domain/workspaces/shell/right-panel-model";
import { normalizeBrowserUrl } from "@/lib/domain/workspaces/shell/browser-url";
import { useTauriBrowserWebviewActions } from "@/hooks/access/tauri/use-browser-webview-actions";
import { BrowserEmptyState } from "./BrowserFallbackStates";
import type { FrameStatus } from "./BrowserPanelTypes";
import { BrowserSurfaces } from "./BrowserSurfaces";
import { BrowserToolbar } from "./BrowserToolbar";

interface WorkspaceBrowserPanelProps {
  workspaceId: string | null;
  tabs: readonly RightPanelBrowserTab[];
  activeBrowserId: string | null;
  isVisible: boolean;
  nativeOverlaysHidden?: boolean;
  onUpdateUrl: (browserId: string, url: string) => void;
}

export function WorkspaceBrowserPanel({
  workspaceId,
  tabs,
  activeBrowserId,
  isVisible,
  nativeOverlaysHidden = false,
  onUpdateUrl,
}: WorkspaceBrowserPanelProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const { isBrowserWebviewAvailable } = useTauriBrowserWebviewActions();
  const activeTab = tabs.find((tab) => tab.id === activeBrowserId) ?? null;
  const [draftById, setDraftById] = useState<Record<string, string>>({});
  const [statusById, setStatusById] = useState<Record<string, FrameStatus>>({});
  const [reloadNonceById, setReloadNonceById] = useState<Record<string, number>>({});
  const [urlError, setUrlError] = useState(false);
  const nativeWebviewsAvailable = useMemo(
    () => isBrowserWebviewAvailable(),
    [isBrowserWebviewAvailable],
  );
  const activeDraft = activeTab
    ? draftById[activeTab.id] ?? activeTab.url ?? ""
    : "";
  const activeStatus = activeTab
    ? statusById[activeTab.id] ?? (activeTab.url ? "loading" : "idle")
    : "idle";

  useEffect(() => {
    if (browserWebviewDiagnosticLoggingEnabled() && !nativeWebviewsAvailable) {
      console.debug("[browser-webview]", "native unavailable; iframe fallback active");
    }
  }, [nativeWebviewsAvailable]);

  useEffect(() => {
    if (activeTab?.url !== activeDraft) {
      setUrlError(false);
    }
  }, [activeDraft, activeTab?.url]);

  const handleFrameStatusChange = useCallback((tabId: string, status: FrameStatus) => {
    setStatusById((current) => ({ ...current, [tabId]: status }));
  }, []);

  const handleDraftChange = useCallback((tabId: string, value: string) => {
    setDraftById((current) => ({ ...current, [tabId]: value }));
  }, []);

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
      <BrowserToolbar
        activeDraft={activeDraft}
        activeStatus={activeStatus}
        activeTab={activeTab}
        urlError={urlError}
        onDraftChange={handleDraftChange}
        onReload={reloadTab}
        onSubmit={handleSubmit}
      />

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

        <BrowserSurfaces
          activeBrowserId={activeBrowserId}
          contentRef={contentRef}
          isPanelVisible={isVisible}
          nativeOverlaysHidden={nativeOverlaysHidden}
          nativeWebviewsAvailable={nativeWebviewsAvailable}
          reloadNonceById={reloadNonceById}
          statusById={statusById}
          tabs={tabs}
          workspaceId={workspaceId}
          onStatusChange={handleFrameStatusChange}
        />
      </div>
    </div>
  );
}

function browserWebviewDiagnosticLoggingEnabled(): boolean {
  return import.meta.env.DEV && import.meta.env.MODE !== "test";
}
