import { type CSSProperties, type ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ArrowUpRight, ChevronDown, ChevronRight } from "@/components/ui/icons";

interface FileChangeStatsProps {
  additions: number;
  deletions: number;
  className?: string;
}

export function FileChangeStats({
  additions,
  deletions,
  className,
}: FileChangeStatsProps) {
  if (!additions && !deletions) {
    return null;
  }

  return (
    <span
      data-thread-find-skip="true"
      className={`inline-flex shrink-0 items-baseline gap-1 tabular-nums tracking-tight ${className ?? ""}`}
    >
      {additions > 0 && (
        <FileChangeStat sign="+" value={additions} className="text-git-green" />
      )}
      {deletions > 0 && (
        <FileChangeStat sign="-" value={deletions} className="text-git-red" />
      )}
    </span>
  );
}

function FileChangeStat({
  sign,
  value,
  className,
}: {
  sign: "+" | "-";
  value: number;
  className: string;
}) {
  return (
    <span className={`shrink-0 text-sm leading-none ${className}`}>
      {sign}
      {value}
    </span>
  );
}

interface FileChangeInlineRowProps {
  label: string;
  filePath: string;
  additions: number;
  deletions: number;
  isExpanded?: boolean;
  onToggle?: () => void;
  onOpenFile?: () => void;
  className?: string;
}

export function FileChangeInlineRow({
  label,
  filePath,
  additions,
  deletions,
  isExpanded = false,
  onToggle,
  onOpenFile,
  className,
}: FileChangeInlineRowProps) {
  const interactive = !!onToggle;
  const fileContent = (
    <span className="truncate [direction:ltr] [unicode-bidi:plaintext]">
      {filePath}
    </span>
  );

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onToggle}
      onKeyDown={
        interactive
          ? (event) => {
              if (
                event.target === event.currentTarget
                && (event.key === "Enter" || event.key === " ")
              ) {
                event.preventDefault();
                onToggle?.();
              }
            }
          : undefined
      }
      className={`group/file-change-row flex min-w-0 items-center gap-1.5 rounded-md px-0 py-0.5 text-chat leading-[var(--text-chat--line-height)] text-muted-foreground transition-colors ${
        interactive ? "cursor-pointer hover:text-foreground" : ""
      } ${className ?? ""}`}
    >
      <span className="shrink-0 text-foreground/80">{label}</span>
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
          className="h-auto min-w-0 max-w-full justify-start rounded-none bg-transparent p-0 text-start text-chat font-normal leading-[var(--text-chat--line-height)] text-link-foreground hover:bg-transparent hover:underline focus-visible:ring-1 focus-visible:ring-border"
        >
          {fileContent}
        </Button>
      ) : (
        <span
          title={filePath}
          className="min-w-0 truncate text-start text-link-foreground"
        >
          {fileContent}
        </span>
      )}
      <FileChangeStats additions={additions} deletions={deletions} />
      {interactive && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={(event) => {
            event.stopPropagation();
            onToggle?.();
          }}
          className="ml-0.5 size-4 shrink-0 text-muted-foreground/55 opacity-0 transition-all duration-150 hover:bg-muted group-hover/file-change-row:opacity-100"
          aria-label={isExpanded ? "Collapse file diff" : "Expand file diff"}
          aria-expanded={isExpanded}
        >
          <ChevronRight
            className={`size-3 transition-transform duration-150 ${
              isExpanded ? "rotate-90" : ""
            }`}
          />
        </Button>
      )}
    </div>
  );
}

interface FileChangesCardProps {
  fileCount: number;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function FileChangesCard({
  fileCount,
  actions,
  children,
  className,
}: FileChangesCardProps) {
  return (
    <div
      className={`mb-2 flex flex-col overflow-hidden rounded-xl bg-[var(--color-diff-panel-surface)] text-base text-foreground ${className ?? ""}`}
    >
      <div className="flex items-center gap-2">
        <div className="flex w-full min-w-0 flex-nowrap items-center gap-1 pr-1 pl-3">
          <span className="min-w-0 truncate py-2 text-chat leading-[var(--text-chat--line-height)] text-foreground">
            {fileCount} file{fileCount !== 1 ? "s" : ""} changed
          </span>
          <div className="flex-1" />
          {actions && <div className="flex shrink-0 items-center">{actions}</div>}
        </div>
      </div>
      <div className="flex flex-col divide-y-[0.5px] divide-border">
        {children}
      </div>
    </div>
  );
}

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
  const surfaceTextClass = isSidebar ? "text-sidebar-foreground" : "text-foreground";
  const surfaceActionClass = isSidebar
    ? "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-sidebar-ring"
    : "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-border";
  const cardClass = isSidebar
    ? "codex-review-diff-card rounded-lg"
    : embedded ? "" : "rounded-lg";
  const cardStyle = {
    "--codex-diffs-surface":
      "var(--codex-diffs-surface-override, var(--color-diff-surface))",
    "--codex-diffs-header-surface": isSidebar
      ? "color-mix(in srgb, var(--codex-diffs-surface) 98%, var(--color-foreground))"
      : "var(--codex-diffs-surface)",
    ...(isSidebar
      ? {
          "--codex-diffs-separator-surface":
            "color-mix(in srgb, var(--codex-diffs-surface) 94%, var(--color-foreground))",
        }
      : {}),
    backgroundColor: "var(--codex-diffs-surface)",
  } as CSSProperties;
  const headerShellClass = isSidebar
    ? "bg-[var(--codex-diffs-header-surface)]"
    : "bg-[var(--codex-diffs-header-surface)]";
  const headerInnerClass = isSidebar
    ? "group/diff-header @container/diff-header relative flex min-h-9 items-center gap-2.5 px-[calc(var(--codex-diffs-header-padding-x,0.75rem)+0.5rem)] py-1.5 text-chat leading-[var(--text-chat--line-height)] hover:bg-[var(--codex-diffs-separator-surface)]"
    : "group/diff-header @container/diff-header relative flex min-h-8 items-center gap-2.5 px-[var(--codex-diffs-header-padding-x,1rem)] py-[var(--codex-diffs-header-padding-y,0.5rem)] text-chat leading-[var(--text-chat--line-height)] hover:bg-foreground/5";
  const actionRevealClass = isSidebar
    ? "opacity-0 transition-opacity duration-200 group-hover/file-diff:opacity-100 group-focus-within/file-diff:opacity-100"
    : "hidden group-hover/diff-header:block group-focus-within/diff-header:block";
  const statsClass = isSidebar
    ? "leading-none"
    : "leading-none group-hover/diff-header:hidden group-focus-within/diff-header:hidden";
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

  const card = (
    <div
      data-diff-surface={surface}
      style={cardStyle}
      className={`group/file-diff flex flex-col overflow-clip bg-[var(--codex-diffs-surface)] ${cardClass}`}
    >
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
        className={`z-10 select-none bg-[var(--codex-diffs-surface)] ${isSidebar ? "sticky top-0" : ""} ${canExpand ? "cursor-pointer" : ""}`}
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
                    isSidebar ? "text-sidebar-foreground hover:text-sidebar-foreground focus-visible:ring-sidebar-ring" : "text-foreground hover:text-foreground focus-visible:ring-border"
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
              {actions && (
                <div className={`flex items-center ${actionRevealClass}`}>
                  {actions}
                </div>
              )}
              {showStats && (
                <FileChangeStats
                  additions={additions}
                  deletions={deletions}
                  className={statsClass}
                />
              )}
              {!additions && !deletions && metadata}
              {handleOpenAction && (
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
