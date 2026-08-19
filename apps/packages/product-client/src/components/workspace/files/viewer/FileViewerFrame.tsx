import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { Button } from "#product/primitives/Button";
import { twMerge } from "#product/primitives/utils/tw-merge";
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  MoreHorizontal,
  Search,
} from "#product/primitives/icons/core";
import { FolderTree } from "#product/primitives/icons/workspace";
import { PaneIconButton } from "#product/primitives/PaneIconButton";
import { PaneOptionsMenuItem } from "#product/primitives/patterns/panel/PaneOptionsMenuItem";
import {
  POPOVER_FRAME_CLASS,
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "#product/primitives/PopoverButton";
import { PaneOptionsMenuSeparator } from "#product/components/workspace/pane/PaneOptionsMenu";
import {
  useFileViewerNativeContextMenu,
  useFileViewerNativeMenu,
  type FileViewerNativeMenuActions,
} from "#product/hooks/workspaces/ui/files/use-file-viewer-native-menu";
import { useContentSearchStore } from "#product/stores/search/content-search-store";

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
  onOpenExternal,
  canOpenExternal,
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
  canOpenExternal: boolean;
  onToggleWordWrap: () => void;
  onToggleRichPreview: () => void;
  onCopyContent: () => void;
  onCopyPath: () => void;
  onOpenExternal: () => void;
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
      <div
        className="z-20 flex h-9 min-h-9 shrink-0 select-none items-center gap-1 border-b border-border bg-background px-2 text-foreground"
        data-file-viewer-toolbar
      >
        <FileBreadcrumbs
          filePath={filePath}
          filesAvailable={filesAvailable}
          onRevealFilesPath={onRevealFilesPath}
        />
        <div className="flex shrink-0 items-center gap-1">
          <FileViewerOptionsMenu
            canRenderRichPreview={canRenderRichPreview}
            richPreviewEnabled={richPreviewEnabled}
            wordWrap={wordWrap}
            canCopyContent={canCopyContent}
            onToggleWordWrap={onToggleWordWrap}
            onToggleRichPreview={onToggleRichPreview}
            onCopyContent={onCopyContent}
            onCopyPath={onCopyPath}
          />
          <FileViewerToolbarButton
            label="Open in default editor"
            disabled={!canOpenExternal}
            onClick={onOpenExternal}
          >
            <ExternalLink className="icon-paired" />
          </FileViewerToolbarButton>
          {canFindInFile && (
            <FileViewerToolbarButton
              label="Find in file"
              onClick={onOpenContentSearch}
            >
              <Search className="icon-paired" />
            </FileViewerToolbarButton>
          )}
          <FileViewerToolbarButton
            label={toggleLabel}
            active={effectiveRequestedOpen}
            disabled={!filesAvailable}
            help={toggleHelp}
            pressed={effectiveRequestedOpen}
            onClick={onToggleFiles}
          >
            <FolderTree className="icon-paired" />
          </FileViewerToolbarButton>
        </div>
      </div>
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

const FILE_VIEWER_TOOLBAR_BUTTON_CLASS =
  // Icons match the right-panel tab's text-relative paired-glyph tier.
  "size-7 rounded-lg text-muted-foreground hover:bg-hover hover:text-foreground data-[state=open]:bg-hover data-[state=open]:text-foreground [&_svg]:icon-paired";

function FileBreadcrumbs({
  filePath,
  filesAvailable,
  onRevealFilesPath,
}: {
  filePath: string;
  filesAvailable: boolean;
  onRevealFilesPath: (path: string) => void;
}) {
  const parts = filePath.split("/").filter(Boolean);
  // The leading crumb is always the literal "Files" — it never derives from
  // the workspace/runtime root. `onRevealFilesPath("")` is its reveal target.
  const crumbs = ["Files", ...parts];

  return (
    <nav
      aria-label="File path"
      className="scrollbar-none flex min-w-0 flex-1 flex-row-reverse items-center overflow-x-auto px-2"
    >
      {/* The reference breadcrumbs sit one step below chat-body size;
          --text-ui is our body-minus-one that scales with appearance
          presets. The line height must clear descenders — leading-none clips
          "g"/"p" inside the nav's scroll container. */}
      <ol className="flex min-w-max flex-1 items-center gap-1 text-ui text-muted-foreground">
        {crumbs.map((part, index) => {
          const isLast = index === crumbs.length - 1;
          const browsable = filesAvailable && !isLast;
          const browsePath = index === 0 ? "" : parts.slice(0, index).join("/");
          return (
            <li key={`${part}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight className="icon-compact shrink-0 text-muted-foreground/50" />}
              {browsable ? (
                <Button
                  type="button"
                  variant="unstyled"
                  size="unstyled"
                  onClick={() => onRevealFilesPath(browsePath)}
                  className="whitespace-nowrap rounded px-0.5 text-muted-foreground hover:text-foreground"
                >
                  {part}
                </Button>
              ) : (
                <span
                  className="whitespace-nowrap font-medium text-foreground"
                >
                  {part}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function FileViewerToolbarButton({
  label,
  active = false,
  disabled = false,
  help,
  pressed,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  help?: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={pressed}
      title={help}
      disabled={disabled}
      className={`${FILE_VIEWER_TOOLBAR_BUTTON_CLASS} ${
        active ? "bg-hover text-foreground" : ""
      }`}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** Shared DOM-fallback item list for the toolbar menu and the context menu. */
function FileViewerMenuBody({
  close,
  canRenderRichPreview,
  richPreviewEnabled,
  wordWrap,
  canCopyContent,
  onToggleWordWrap,
  onToggleRichPreview,
  onCopyContent,
  onCopyPath,
}: FileViewerNativeMenuActions & { close: () => void }) {
  return (
    <div className="flex flex-col gap-px">
      <PaneOptionsMenuItem
        icon={<Copy />}
        label="Copy content"
        disabled={!canCopyContent}
        onClick={() => {
          onCopyContent();
          close();
        }}
      />
      <PaneOptionsMenuItem
        icon={<Copy />}
        label="Copy path"
        onClick={() => {
          onCopyPath();
          close();
        }}
      />
      <PaneOptionsMenuSeparator />
      <PaneOptionsMenuItem
        reserveIconSlot
        icon={wordWrap ? <Check /> : null}
        label="Word wrap"
        trailing={wordWrap ? "On" : "Off"}
        onClick={() => {
          onToggleWordWrap();
        }}
      />
      {canRenderRichPreview && (
        <PaneOptionsMenuItem
          reserveIconSlot
          icon={richPreviewEnabled ? <Check /> : null}
          label="Rich preview"
          trailing={richPreviewEnabled ? "On" : "Off"}
          onClick={() => {
            onToggleRichPreview();
          }}
        />
      )}
    </div>
  );
}

/**
 * Toolbar "…" menu. Click opens the OS-native menu under the button (Tauri);
 * the DOM popover remains the browser/test fallback (opened via externalOpen,
 * anchored at the trigger). triggerMode="contextMenu" keeps PopoverButton's
 * own click handling out of the way so a click never opens both menus.
 */
function FileViewerOptionsMenu(actions: FileViewerNativeMenuActions) {
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const { showNativeMenu } = useFileViewerNativeMenu(actions);

  const handleTriggerClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    void showNativeMenu({ x: rect.left, y: rect.bottom }).then((shown) => {
      if (!shown) setFallbackOpen(true);
    });
  }, [showNativeMenu]);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setFallbackOpen(false);
  }, []);

  return (
    <PopoverButton
      triggerMode="contextMenu"
      externalOpen={fallbackOpen}
      onOpenChange={handleOpenChange}
      align="end"
      // C4: this toolbar menu's own content is narrower than
      // `POPOVER_SURFACE_CLASS`'s baseline `min-w-[240px]`; the override
      // matches the same 220px the DOM-fallback context menu above uses for
      // the identical item list.
      className={twMerge(POPOVER_SURFACE_CLASS, "min-w-[220px]")}
      trigger={(
        <PaneIconButton
          label="File viewer options"
          className={FILE_VIEWER_TOOLBAR_BUTTON_CLASS}
          onClick={handleTriggerClick}
        >
          <MoreHorizontal className="icon-paired" />
        </PaneIconButton>
      )}
    >
      {(close) => <FileViewerMenuBody close={close} {...actions} />}
    </PopoverButton>
  );
}
