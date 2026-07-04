import { type CSSProperties, type ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ArrowUpRight, ChevronDown } from "@proliferate/ui/icons";
import { FileChangeStats } from "@/components/content/ui/FileChangeStats";
import { ChatDiffLineWrapContextMenu } from "@/components/content/ui/diff/ChatDiffLineWrapContextMenu";

interface FileDiffCardProps {
  filePath: string;
  additions: number;
  deletions: number;
  displayLabel?: string;
  showStats?: boolean;
  isExpanded: boolean;
  onToggleExpand?: () => void;
  onOpenFile?: () => void;
  onOpenAction?: () => void;
  openActionLabel?: string;
  openActionTitle?: string;
  actions?: ReactNode;
  children?: ReactNode;
  metadata?: ReactNode;
  embedded?: boolean;
  collapsible?: boolean;
  headerTone?: "default" | "inlineTool";
  showOpenAction?: boolean;
  surface?: "chat" | "sidebar";
}

export function FileDiffCard({
  filePath,
  additions,
  deletions,
  displayLabel,
  showStats = true,
  isExpanded,
  onToggleExpand,
  onOpenFile,
  onOpenAction,
  openActionLabel,
  openActionTitle,
  actions,
  children,
  metadata,
  embedded = false,
  collapsible = true,
  headerTone = "default",
  showOpenAction = true,
  surface = "chat",
}: FileDiffCardProps) {
  const canExpand =
    collapsible
    && !!onToggleExpand
    && (!!children || additions > 0 || deletions > 0);
  const handleOpenAction = onOpenAction ?? onOpenFile;
  const showChildren = !!children && (!collapsible || isExpanded);
  const basename = extractBasename(filePath);
  const displayPath = formatDiffHeaderPath(filePath);
  const compactLabel = displayLabel ?? basename;
  const fullLabel = displayLabel ?? displayPath;
  const isSidebar = surface === "sidebar";
  const chatTextClass = embedded ? "text-foreground" : "text-muted-foreground";
  const chatPathButtonClass = embedded
    ? "text-foreground hover:text-foreground focus-visible:ring-border"
    : "text-muted-foreground hover:text-foreground focus-visible:ring-border";
  const surfaceTextClass = isSidebar ? "text-sidebar-foreground" : chatTextClass;
  const surfaceActionClass = isSidebar
    ? "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-sidebar-ring"
    : "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-border";
  const cardClass = isSidebar
    ? "codex-review-diff-card rounded-lg"
    : embedded ? "" : "rounded-lg";
  const cardStyle = {
    "--codex-diffs-surface":
      "var(--codex-diffs-surface-override, var(--color-diff-panel-surface))",
    "--codex-diffs-header-surface": isSidebar
      ? "var(--color-diff-sidebar-file-header-surface)"
      : headerTone === "inlineTool"
        ? "var(--color-diff-chat-inline-tool-header-surface)"
        : "var(--color-diff-chat-file-header-surface)",
    ...(isSidebar
      ? {
          "--codex-diffs-separator-surface":
            "var(--color-diff-sidebar-file-header-hover-surface)",
        }
      : {}),
    backgroundColor: "var(--codex-diffs-surface)",
  } as CSSProperties;
  // Sidebar review cards use a frosted sticky header: the sticky wrapper paints
  // a translucent color-mix of the header surface + backdrop-blur, so the
  // inner shell must stay transparent for the blur to read through.
  const headerShellClass = isSidebar
    ? "bg-transparent"
    : "bg-[var(--codex-diffs-header-surface)]";
  const chatHeaderHoverClass = headerTone === "inlineTool"
    ? "hover:bg-[var(--color-diff-chat-inline-tool-header-hover-surface)]"
    : "hover:bg-[var(--color-diff-chat-file-header-hover-surface)]";
  const headerInnerClass = isSidebar
    ? "group/diff-header @container/diff-header relative flex min-h-9 items-center gap-2.5 px-[calc(var(--codex-diffs-header-padding-x,0.75rem)+0.5rem)] py-1.5 text-chat leading-[var(--text-chat--line-height)] hover:bg-[var(--codex-diffs-separator-surface)]"
    : `group/diff-header @container/diff-header relative flex min-h-7 items-center gap-2 px-[var(--codex-diffs-header-padding-x,1rem)] py-[var(--codex-diffs-header-padding-y,0.25rem)] text-chat leading-[var(--text-chat--line-height)] transition-colors ${chatHeaderHoverClass}`;
  const actionRevealClass = "opacity-0 transition-opacity duration-200 group-hover/file-diff:opacity-100 group-focus-within/file-diff:opacity-100 group-hover/diff-header:opacity-100 group-focus-within/diff-header:opacity-100";
  const statsClass = isSidebar
    ? "leading-none"
    : "text-chat leading-none text-muted-foreground";
  const pathContent = (
    <>
      <span className="min-w-0 truncate text-chat leading-[var(--text-chat--line-height)] [direction:ltr] [unicode-bidi:plaintext] @xs/diff-header:hidden">
        {compactLabel}
      </span>
      <span className="hidden min-w-0 truncate text-chat leading-[var(--text-chat--line-height)] [direction:ltr] [unicode-bidi:plaintext] @xs/diff-header:inline">
        {fullLabel}
      </span>
    </>
  );

  const header = (
    <div
      role={canExpand ? "button" : undefined}
      tabIndex={canExpand ? 0 : undefined}
      aria-expanded={canExpand ? isExpanded : undefined}
      onClick={canExpand ? onToggleExpand : undefined}
      onKeyDown={
        canExpand
          ? (e) => {
              if (
                e.target === e.currentTarget
                && (e.key === "Enter" || e.key === " ")
              ) {
                e.preventDefault();
                onToggleExpand();
              }
            }
          : undefined
      }
      data-chat-diff-wrap-context-trigger={isSidebar ? undefined : "file-header"}
      className={`z-10 select-none ${isSidebar ? "sticky top-0 backdrop-blur-sm bg-[color-mix(in_srgb,var(--codex-diffs-header-surface)_88%,transparent)]" : "bg-[var(--codex-diffs-header-surface)]"} ${canExpand ? "cursor-pointer" : ""}`}
    >
      <div className={headerShellClass}>
        <div className={headerInnerClass}>
          <div className={`flex min-w-0 flex-1 items-center gap-2 ${surfaceTextClass}`}>
            {onOpenFile ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                title={filePath}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenFile();
                }}
                className={`h-auto min-w-0 truncate rounded-none border-0 bg-transparent p-0 text-start text-chat font-normal leading-[var(--text-chat--line-height)] shadow-none select-text [direction:rtl] hover:bg-transparent focus-visible:ring-1 ${
                  isSidebar ? "text-sidebar-foreground hover:text-sidebar-foreground focus-visible:ring-sidebar-ring" : chatPathButtonClass
                }`}
              >
                {pathContent}
              </Button>
            ) : (
              <span
                className="min-w-0 truncate text-start text-chat leading-[var(--text-chat--line-height)] [direction:rtl]"
                title={filePath}
              >
                {pathContent}
              </span>
            )}
          </div>

          <div className="ms-auto flex shrink-0 items-center gap-1.5">
            {showStats && (
              <FileChangeStats
                additions={additions}
                deletions={deletions}
                className={statsClass}
              />
            )}
            {actions && (
              <div className={`flex items-center ${actionRevealClass}`}>
                {actions}
              </div>
            )}
            {!additions && !deletions && metadata}
            {showOpenAction && handleOpenAction && (
              <div className={`shrink-0 ${actionRevealClass}`}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleOpenAction();
                  }}
                  className={`size-6 rounded-lg border-0 bg-transparent p-0 transition-colors focus-visible:ring-1 ${surfaceActionClass}`}
                  aria-label={openActionLabel ?? `Open ${filePath}`}
                  title={openActionTitle ?? "Open file"}
                >
                  <ArrowUpRight className="size-3.5" />
                </Button>
              </div>
            )}
            {canExpand && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand();
                }}
                className={`size-6 shrink-0 rounded-lg border-0 bg-transparent p-0 transition-colors focus-visible:ring-1 ${surfaceActionClass}`}
                aria-label="Toggle file diff"
                aria-expanded={isExpanded}
                data-app-action-review-file-expanded={isExpanded ? "true" : "false"}
                data-app-action-review-file-toggle=""
              >
                <ChevronDown
                  className={`size-3.5 transition-transform duration-200 ${
                    isExpanded ? "rotate-180" : "rotate-0"
                  }`}
                />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
  const headerWithContextMenu = isSidebar
    ? header
    : <ChatDiffLineWrapContextMenu trigger={header} />;

  const card = (
    <div
      data-diff-surface={surface}
      style={cardStyle}
      className={`group/file-diff flex flex-col overflow-clip bg-[var(--codex-diffs-surface)] ${cardClass}`}
    >
      {headerWithContextMenu}

      {showChildren && (
        <div className="relative overflow-hidden">
          {children}
        </div>
      )}
    </div>
  );

  return isSidebar ? card : <div className="thread-diff-virtualized">{card}</div>;
}

function extractBasename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function formatDiffHeaderPath(path: string): string {
  if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path)) {
    return path;
  }

  const normalized = path.replace(/\\/g, "/");
  const homeMatch = normalized.match(/^\/Users\/[^/]+\/(.+)$/);
  const compactPath = homeMatch?.[1] ?? normalized.replace(/^\/+/, "");
  const segments = compactPath.split("/").filter(Boolean);

  if (segments.length === 0) {
    return path;
  }

  if (segments.length <= 3) {
    return segments.join("/");
  }

  return `.../${segments.slice(-3).join("/")}`;
}
