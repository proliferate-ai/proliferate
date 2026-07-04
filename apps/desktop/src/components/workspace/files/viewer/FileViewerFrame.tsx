import type {
  ReactNode,
  Ref,
} from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  FolderTree,
  Search,
  WrapText,
} from "@proliferate/ui/icons";
import { PaneOptionsMenuItem } from "@proliferate/ui/layout/PaneOptionsMenuItem";
import {
  PaneOptionsMenu,
  PaneOptionsMenuSeparator,
} from "@/components/workspace/pane/PaneOptionsMenu";
import { SessionContentSearchOverlay } from "@/components/workspace/chat/surface/SessionContentSearchOverlay";
import { useWorkspacePath } from "@/providers/WorkspacePathProvider";

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
  onOpenContentSearch,
  browserOpen,
  onToggleBrowser,
  onBrowsePath,
  children,
}: {
  rootRef?: Ref<HTMLDivElement>;
  filePath: string;
  canRenderRichPreview: boolean;
  wordWrap: boolean;
  richPreviewEnabled: boolean;
  canCopyContent: boolean;
  canFindInFile: boolean;
  onToggleWordWrap: () => void;
  onToggleRichPreview: () => void;
  onCopyContent: () => void;
  onCopyPath: () => void;
  onOpenExternal: () => void;
  onOpenContentSearch: () => void;
  browserOpen: boolean;
  onToggleBrowser: () => void;
  onBrowsePath: (path: string) => void;
  children: ReactNode;
}) {
  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="relative flex h-full min-w-0 flex-col overflow-hidden bg-background outline-none"
      data-file-viewer-frame
    >
      <div
        className="z-20 flex h-9 min-h-9 shrink-0 items-center gap-1 border-b border-border bg-background px-2 text-foreground"
        data-file-viewer-toolbar
      >
        <FileBreadcrumbs filePath={filePath} onBrowsePath={onBrowsePath} />
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
            onClick={onOpenExternal}
          >
            <ExternalLink className="size-4" />
          </FileViewerToolbarButton>
          {canFindInFile && (
            <FileViewerToolbarButton
              label="Find in file"
              onClick={onOpenContentSearch}
            >
              <Search className="size-4" />
            </FileViewerToolbarButton>
          )}
          <FileViewerToolbarButton
            label={browserOpen ? "Hide files" : "Show files"}
            active={browserOpen}
            onClick={onToggleBrowser}
          >
            <FolderTree className="size-4" />
          </FileViewerToolbarButton>
        </div>
      </div>
      <SessionContentSearchOverlay enabled surface="file" />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}

const FILE_VIEWER_TOOLBAR_BUTTON_CLASS =
  "size-7 rounded-lg text-muted-foreground hover:bg-list-hover hover:text-foreground data-[state=open]:bg-list-hover data-[state=open]:text-foreground [&_svg]:size-4";

function FileBreadcrumbs({
  filePath,
  onBrowsePath,
}: {
  filePath: string;
  onBrowsePath: (path: string) => void;
}) {
  const { workspacePath } = useWorkspacePath();
  const workspaceName = workspacePath
    ? workspacePath.split("/").filter(Boolean).pop()
    : null;
  const parts = filePath.split("/").filter(Boolean);
  const crumbs = workspaceName ? [workspaceName, ...parts] : parts;
  const workspaceOffset = workspaceName ? 1 : 0;

  return (
    <nav
      aria-label="File path"
      className="hide-scrollbar flex min-w-0 flex-1 flex-row-reverse items-center overflow-x-auto px-2"
    >
      <ol className="flex min-w-max flex-1 items-center gap-1 text-[12px] leading-none text-muted-foreground">
        {crumbs.map((part, index) => {
          const isLast = index === crumbs.length - 1;
          const isWorkspaceCrumb = workspaceName && index === 0;
          const browsable = !isLast;
          const browsePath = isWorkspaceCrumb
            ? ""
            : parts.slice(0, Math.max(0, index - workspaceOffset + 1)).join("/");
          return (
            <li key={`${part}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" />}
              {browsable ? (
                <Button
                  type="button"
                  variant="unstyled"
                  size="unstyled"
                  onClick={() => onBrowsePath(browsePath)}
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
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      className={`${FILE_VIEWER_TOOLBAR_BUTTON_CLASS} ${
        active ? "bg-list-hover text-foreground" : ""
      }`}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function FileViewerOptionsMenu({
  canRenderRichPreview,
  richPreviewEnabled,
  wordWrap,
  canCopyContent,
  onToggleWordWrap,
  onToggleRichPreview,
  onCopyContent,
  onCopyPath,
}: {
  canRenderRichPreview: boolean;
  richPreviewEnabled: boolean;
  wordWrap: boolean;
  canCopyContent: boolean;
  onToggleWordWrap: () => void;
  onToggleRichPreview: () => void;
  onCopyContent: () => void;
  onCopyPath: () => void;
}) {
  return (
    <PaneOptionsMenu
      label="File viewer options"
      className="min-w-[220px]"
      triggerClassName={FILE_VIEWER_TOOLBAR_BUTTON_CLASS}
    >
      {(close) => (
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
      )}
    </PaneOptionsMenu>
  );
}
