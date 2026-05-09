import type { RefObject } from "react";
import type { RightPanelBrowserTab } from "@/lib/domain/workspaces/shell/right-panel";
import { BrowserFrame } from "./BrowserFrame";
import { BrowserNativeSurface } from "./BrowserNativeSurface";
import type { FrameStatus } from "./BrowserPanelTypes";

export function BrowserSurfaces({
  activeBrowserId,
  contentRef,
  isPanelVisible,
  nativeOverlaysHidden,
  nativeWebviewsAvailable,
  reloadNonceById,
  statusById,
  tabs,
  workspaceId,
  onStatusChange,
}: {
  activeBrowserId: string | null;
  contentRef: RefObject<HTMLDivElement | null>;
  isPanelVisible: boolean;
  nativeOverlaysHidden: boolean;
  nativeWebviewsAvailable: boolean;
  reloadNonceById: Record<string, number>;
  statusById: Record<string, FrameStatus>;
  tabs: readonly RightPanelBrowserTab[];
  workspaceId: string | null;
  onStatusChange: (tabId: string, status: FrameStatus) => void;
}) {
  return (
    <>
      {tabs.map((tab) =>
        nativeWebviewsAvailable ? (
          <BrowserNativeSurface
            key={`${tab.id}:${reloadNonceById[tab.id] ?? 0}`}
            workspaceId={workspaceId}
            tab={tab}
            active={tab.id === activeBrowserId}
            isPanelVisible={isPanelVisible}
            nativeOverlaysHidden={nativeOverlaysHidden}
            reloadKey={reloadNonceById[tab.id] ?? 0}
            contentRef={contentRef}
            status={statusById[tab.id] ?? (tab.url ? "loading" : "idle")}
            onStatusChange={onStatusChange}
          />
        ) : (
          <BrowserFrame
            key={`${tab.id}:${reloadNonceById[tab.id] ?? 0}`}
            tab={tab}
            active={isPanelVisible && tab.id === activeBrowserId}
            status={statusById[tab.id] ?? (tab.url ? "loading" : "idle")}
            onStatusChange={onStatusChange}
          />
        )
      )}
    </>
  );
}
