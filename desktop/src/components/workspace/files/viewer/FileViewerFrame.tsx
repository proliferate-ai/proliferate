import type {
  ReactNode,
  Ref,
} from "react";
import {
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  WrapText,
} from "@/components/ui/icons";
import {
  PaneHeader,
  PaneIconButton,
} from "@/components/workspace/pane/PaneHeader";
import {
  PaneOptionsMenu,
  PaneOptionsMenuItem,
  PaneOptionsMenuSeparator,
} from "@/components/workspace/pane/PaneOptionsMenu";
import { useWorkspacePath } from "@/providers/WorkspacePathProvider";

export function FileViewerFrame({
  rootRef,
  filePath,
  canRenderRichPreview,
  wordWrap,
  richPreviewEnabled,
  canCopyContent,
  onToggleWordWrap,
  onToggleRichPreview,
  onCopyContent,
  onCopyPath,
  onOpenExternal,
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
  onToggleWordWrap: () => void;
  onToggleRichPreview: () => void;
  onCopyContent: () => void;
  onCopyPath: () => void;
  onOpenExternal: () => void;
  browserOpen: boolean;
  onToggleBrowser: () => void;
  onBrowsePath: (path: string) => void;
  children: ReactNode;
}) {
  return (
    <div ref={rootRef} tabIndex={-1} className="flex h-full min-w-0 flex-col overflow-hidden bg-background outline-none">
      <PaneHeader
        left={<FileBreadcrumbs filePath={filePath} onBrowsePath={onBrowsePath} />}
        right={(
          <>
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
          <PaneIconButton
            label="Open in default editor"
            onClick={onOpenExternal}
          >
            <ExternalLink className="size-3.5" />
          </PaneIconButton>
          <PaneIconButton
            label={browserOpen ? "Hide files" : "Show files"}
            active={browserOpen}
            onClick={onToggleBrowser}
          >
            <FolderOpen className="size-3.5" />
          </PaneIconButton>
          </>
        )}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}

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
      className="hide-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto px-2"
    >
      <ol className="flex min-w-0 items-center gap-1 text-xs text-sidebar-muted-foreground">
        {crumbs.map((part, index) => {
          const isLast = index === crumbs.length - 1;
          const isWorkspaceCrumb = workspaceName && index === 0;
          const browsable = !isLast;
          const browsePath = isWorkspaceCrumb
            ? ""
            : parts.slice(0, Math.max(0, index - workspaceOffset + 1)).join("/");
          return (
            <li key={`${part}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight className="size-3.5 shrink-0 text-sidebar-muted-foreground/55" />}
              {browsable ? (
                <button
                  type="button"
                  onClick={() => onBrowsePath(browsePath)}
                  className="whitespace-nowrap rounded px-0.5 text-sidebar-muted-foreground hover:text-sidebar-foreground"
                >
                  {part}
                </button>
              ) : (
                <span
                  className="whitespace-nowrap font-medium text-sidebar-foreground"
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
            icon={<WrapText />}
            label={wordWrap ? "Disable word wrap" : "Enable word wrap"}
            onClick={() => {
              onToggleWordWrap();
              close();
            }}
          />
          {canRenderRichPreview && (
            <PaneOptionsMenuItem
              icon={<FileText />}
              label={richPreviewEnabled ? "Disable rich preview" : "Enable rich preview"}
              onClick={() => {
                onToggleRichPreview();
                close();
              }}
            />
          )}
        </div>
      )}
    </PaneOptionsMenu>
  );
}
