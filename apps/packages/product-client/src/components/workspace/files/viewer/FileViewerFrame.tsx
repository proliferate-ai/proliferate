import { useEffect, type ReactNode, type Ref } from "react";
import { POPOVER_FRAME_CLASS, PopoverButton } from "#product/primitives/PopoverButton";
import type { OpenTarget } from "@proliferate/product-client/host/desktop-bridge";
import {
  useFileViewerNativeContextMenu,
  type FileViewerNativeMenuActions,
} from "#product/hooks/workspaces/ui/files/use-file-viewer-native-menu";
import { useContentSearchStore } from "#product/stores/search/content-search-store";
import { FileViewerMenuBody, FileViewerToolbar } from "./FileViewerToolbar";

const FILES_UNAVAILABLE_HELP = "Files are unavailable for this workspace";
const FILES_GEOMETRY_HIDDEN_HELP = "Widen the window to show files";

export function FileViewerFrame({
  rootRef,
  filePath,
  canRenderRichPreview,
  wordWrap,
  richPreviewEnabled,
  canCopyContent,
  canFindInFile,
  onToggleWordWrap,
  onToggleRichPreview,
  onCopyContent,
  onCopyPath,
  openInEligible,
  openInDefaultTarget,
  openInTargets,
  onOpenDefault,
  onOpenWithTarget,
  openInRevision,
  openInFailed,
  onOpenContentSearch,
  filesAvailable,
  filesRequestedOpen,
  onToggleFiles,
  onRevealFilesPath,
  fileTreeDock,
  children,
}: {
  rootRef?: Ref<HTMLDivElement>;
  filePath: string;
  canRenderRichPreview: boolean;
  wordWrap: boolean;
  richPreviewEnabled: boolean;
  canCopyContent: boolean;
  canFindInFile: boolean;
  openInEligible: boolean;
  openInDefaultTarget: OpenTarget | null;
  openInTargets: OpenTarget[];
  onOpenDefault: () => void;
  onOpenWithTarget: (target: OpenTarget) => void;
  openInRevision: number;
  openInFailed: boolean;
  onToggleWordWrap: () => void;
  onToggleRichPreview: () => void;
  onCopyContent: () => void;
  onCopyPath: () => void;
  onOpenContentSearch: () => void;
  filesAvailable: boolean;
  filesRequestedOpen: boolean;
  onToggleFiles: () => void;
  onRevealFilesPath: (path: string) => void;
  fileTreeDock: ReactNode | null;
  children: ReactNode;
}) {
  const setSurfaceAvailability = useContentSearchStore((state) => state.setSurfaceAvailability);
  useEffect(() => {
    setSurfaceAvailability("file", true);
    return () => setSurfaceAvailability("file", false);
  }, [setSurfaceAvailability]);

  // Unavailable dominates any stale requested value: a workspace that lost
  // file-context availability while a dock was requested open must not show
  // a pressed/enabled toggle for a dock it can no longer serve.
  const effectiveRequestedOpen = filesAvailable && filesRequestedOpen;
  const geometryHidden = effectiveRequestedOpen && fileTreeDock === null;
  const toggleLabel = effectiveRequestedOpen ? "Hide files" : "Show files";
  const toggleHelp = !filesAvailable
    ? FILES_UNAVAILABLE_HELP
    : geometryHidden ? FILES_GEOMETRY_HIDDEN_HELP : undefined;

  return (
    // `w-full`: without it the body measures max-content (380 + dock) and the
    // responsive auto-collapse threshold can never be crossed.
    <div
      ref={rootRef}
      tabIndex={-1}
      className="relative flex h-full w-full min-w-0 flex-col overflow-hidden bg-background outline-none"
      data-file-viewer-frame
    >
      <FileViewerToolbar
        filePath={filePath}
        filesAvailable={filesAvailable}
        onRevealFilesPath={onRevealFilesPath}
        canRenderRichPreview={canRenderRichPreview}
        richPreviewEnabled={richPreviewEnabled}
        wordWrap={wordWrap}
        canCopyContent={canCopyContent}
        canFindInFile={canFindInFile}
        onToggleWordWrap={onToggleWordWrap}
        onToggleRichPreview={onToggleRichPreview}
        onCopyContent={onCopyContent}
        onCopyPath={onCopyPath}
        openInEligible={openInEligible}
        openInDefaultTarget={openInDefaultTarget}
        openInTargets={openInTargets}
        onOpenDefault={onOpenDefault}
        onOpenWithTarget={onOpenWithTarget}
        openInRevision={openInRevision}
        openInFailed={openInFailed}
        onOpenContentSearch={onOpenContentSearch}
        toggleLabel={toggleLabel}
        toggleActive={effectiveRequestedOpen}
        toggleHelp={toggleHelp}
        onToggleFiles={onToggleFiles}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden" data-file-viewer-body>
        {fileTreeDock}
        <div className="flex min-h-0 min-w-[380px] flex-1 flex-col overflow-hidden" data-file-viewer-content>
          <FileViewerContentContextMenu
            canRenderRichPreview={canRenderRichPreview}
            richPreviewEnabled={richPreviewEnabled}
            wordWrap={wordWrap}
            canCopyContent={canCopyContent}
            onToggleWordWrap={onToggleWordWrap}
            onToggleRichPreview={onToggleRichPreview}
            onCopyContent={onCopyContent}
            onCopyPath={onCopyPath}
          >
            {children}
          </FileViewerContentContextMenu>
        </div>
      </div>
    </div>
  );
}

/**
 * Right-click in the content area shows the OS-native menu (Tauri); the DOM
 * popover below is the browser/test fallback — the capture-phase native
 * handler preventDefaults before the PopoverButton's bubble listener fires.
 */
function FileViewerContentContextMenu({
  children,
  ...actions
}: FileViewerNativeMenuActions & { children: ReactNode }) {
  const { onContextMenuCapture } = useFileViewerNativeContextMenu(actions);

  return (
    <PopoverButton
      triggerMode="contextMenu"
      // C4: a fixed width tuned for this menu's longest item ("Rich
      // preview" + trailing "On"/"Off"); narrower than
      // `POPOVER_SURFACE_CLASS`'s own `min-w-[240px]` deliberately, this is
      // a compact DOM-fallback context menu, not a popover surface.
      className={`${POPOVER_FRAME_CLASS} flex w-[220px] select-none flex-col overflow-y-auto p-1`}
      trigger={
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          onContextMenuCapture={onContextMenuCapture}
        >
          {children}
        </div>
      }
    >
      {(close) => <FileViewerMenuBody close={close} {...actions} />}
    </PopoverButton>
  );
}
