import { type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
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
      className={`inline-flex shrink-0 items-center gap-1 tabular-nums tracking-tight ${className ?? ""}`}
    >
      {additions > 0 && (
        <span className="shrink-0 text-git-green">+{additions}</span>
      )}
      {deletions > 0 && (
        <span className="shrink-0 text-git-red">-{deletions}</span>
      )}
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
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenFile?: () => void;
  actions?: ReactNode;
  children?: ReactNode;
  embedded?: boolean;
  surface?: "chat" | "sidebar";
}

export function FileDiffCard({
  filePath,
  additions,
  deletions,
  isExpanded,
  onToggleExpand,
  onOpenFile,
  actions,
  children,
  embedded = false,
  surface = "chat",
}: FileDiffCardProps) {
  const canExpand = !!children || additions > 0 || deletions > 0;
  const basename = extractBasename(filePath);
  const surfaceTextClass = surface === "sidebar" ? "text-sidebar-foreground" : "text-foreground";
  const surfaceActionClass = surface === "sidebar"
    ? "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-sidebar-ring"
    : "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-border";
  const cardStyle = {
    "--codex-diffs-surface":
      "var(--codex-diffs-surface-override, var(--color-diff-surface))",
    "--codex-diffs-header-surface": "var(--codex-diffs-surface)",
    backgroundColor: "var(--codex-diffs-surface)",
  } as CSSProperties;
  const pathContent = (
    <>
      <span className="min-w-0 truncate text-chat leading-[var(--text-chat--line-height)] [direction:ltr] [unicode-bidi:plaintext] @xs/diff-header:hidden">
        {basename}
      </span>
      <span className="hidden min-w-0 truncate text-chat leading-[var(--text-chat--line-height)] [direction:ltr] [unicode-bidi:plaintext] @xs/diff-header:inline">
        {filePath}
      </span>
    </>
  );

  return (
    <div className="thread-diff-virtualized">
      <div
        data-diff-surface={surface}
        style={cardStyle}
        className={`group/file-diff flex flex-col overflow-clip bg-[var(--codex-diffs-surface)] ${
          embedded ? "" : "rounded-lg"
        }`}
      >
        <div
          role={canExpand ? "button" : undefined}
          tabIndex={canExpand ? 0 : undefined}
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
          className={`select-none bg-[var(--codex-diffs-surface)] ${canExpand ? "cursor-pointer" : ""}`}
        >
          <div className="bg-[var(--codex-diffs-header-surface)]">
            <div className="group @container/diff-header relative flex items-center gap-2 pt-1 pr-1 pb-1 pl-3 text-chat leading-[var(--text-chat--line-height)]">
              <div className={`flex min-w-0 items-center gap-2 pb-0.5 ${surfaceTextClass}`}>
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
                    className={`h-auto min-w-0 truncate rounded-none border-0 bg-transparent p-0 text-start text-chat font-normal leading-[var(--text-chat--line-height)] shadow-none select-text [direction:rtl] hover:bg-transparent hover:underline focus-visible:ring-1 ${
                      surface === "sidebar" ? "text-sidebar-foreground hover:text-sidebar-foreground focus-visible:ring-sidebar-ring" : "text-foreground hover:text-foreground focus-visible:ring-border"
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
                <span className="ml-auto shrink-0">
                  <FileChangeStats additions={additions} deletions={deletions} />
                </span>
              </div>

              <div className="ms-auto mr-1 flex items-center gap-1">
                {onOpenFile && (
                  <div className="shrink-0 opacity-0 transition-opacity duration-200 group-hover/file-diff:opacity-100">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenFile();
                      }}
                      className={`size-5 rounded-full border-0 bg-transparent p-0 transition-colors focus-visible:ring-1 ${surfaceActionClass}`}
                      aria-label={`Open ${filePath}`}
                      title="Open file"
                    >
                      <ArrowUpRight className="size-3" />
                    </Button>
                  </div>
                )}
                {actions && (
                  <div className="flex items-center opacity-0 transition-opacity duration-200 group-hover/file-diff:opacity-100">
                    {actions}
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
                    className={`size-5 shrink-0 rounded-full border-0 bg-transparent p-0 transition-colors focus-visible:ring-1 ${surfaceActionClass}`}
                    aria-label="Toggle file diff"
                  >
                    <ChevronDown
                      className={`size-3 transition-transform duration-200 ${
                        isExpanded ? "rotate-180" : "rotate-0"
                      }`}
                    />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {canExpand && isExpanded && children && (
          <div className="relative overflow-hidden">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

function extractBasename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}
