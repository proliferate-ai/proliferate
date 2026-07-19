import type { ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ArrowUpRight, ChevronDown } from "@proliferate/ui/icons";
import { FileChangeStats } from "#product/components/content/ui/FileChangeStats";
import { FileTreeEntryIcon } from "#product/components/workspace/files/file-icons";
import type { GitPanelReviewFile } from "#product/lib/domain/workspaces/changes/git-panel-diff";

const REVIEW_HEADER_ACTION_CLASS =
  "size-6 shrink-0 rounded-md border-0 bg-transparent p-0 text-sidebar-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring";

/**
 * Flat review-document section: sticky Codex-style header (file icon,
 * front-truncated path with dimmed directory, status chip, always-on +N/−N)
 * over the diff body. Replaces the FileDiffCard card look for the git pane.
 */
export function GitReviewFileSectionShell({
  file,
  additions,
  deletions,
  binary,
  showStagedChip,
  collapsed,
  onToggleCollapsed,
  onOpenFile,
  children,
}: {
  file: GitPanelReviewFile;
  additions: number;
  deletions: number;
  binary: boolean;
  showStagedChip: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenFile: () => void;
  children: ReactNode;
}) {
  const name = basenameOf(file.path);
  const dir = file.path.slice(0, file.path.length - name.length);
  const status = file.currentDiff?.status ?? null;
  const statusChip = status === "deleted" || status === "renamed" || status === "copied"
    ? status
    : null;
  const hoverTitle = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;

  return (
    <section
      data-review-file-section=""
      className="bg-[var(--color-background)]"
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={onToggleCollapsed}
        onKeyDown={(event) => {
          if (
            event.target === event.currentTarget
            && (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            onToggleCollapsed();
          }
        }}
        // Near-opaque color-mix, never backdrop-blur: blur resampling across
        // many sticky headers starves the WKWebView compositor.
        className="sticky top-0 z-10 cursor-pointer select-none bg-[color-mix(in_srgb,var(--color-diff-sidebar-file-header-surface)_97%,transparent)]"
      >
        <div className="group/diff-header @container/diff-header flex min-h-8 items-center gap-2 px-3 py-1 text-chat leading-[var(--text-chat--line-height)] text-sidebar-foreground hover:bg-[var(--color-diff-sidebar-file-header-hover-surface)]">
          {/* The growing flex item is this container; the name span inside is
              content-sized so every row's name is left-anchored beside the
              icon. [direction:rtl] front-truncates overflow so the basename
              (the tail) always stays visible. */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <FileTreeEntryIcon
              name={name}
              path={file.path}
              kind="file"
              className="icon-paired shrink-0"
            />
            <span className="min-w-0 truncate [direction:rtl]" title={hoverTitle}>
              <span className="min-w-0 truncate [direction:ltr] [unicode-bidi:plaintext] @xs/diff-header:hidden">
                {name}
              </span>
              <span className="hidden min-w-0 truncate [direction:ltr] [unicode-bidi:plaintext] @xs/diff-header:inline">
                <span className="text-sidebar-muted-foreground">{dir}</span>
                <span className="text-sidebar-foreground">{name}</span>
              </span>
            </span>
            {/* Stats trail the title directly (Codex changes-pane layout),
                not right-aligned; only hover actions pin to the edge. */}
            <span className="flex shrink-0 items-center gap-1.5">
              {showStagedChip && <GitReviewHeaderChip label="staged" />}
              {statusChip && <GitReviewHeaderChip label={statusChip} />}
              {binary && additions === 0 && deletions === 0 ? (
                <span className="text-[length:var(--text-ui-sm)] text-sidebar-muted-foreground">
                  binary
                </span>
              ) : (
                <FileChangeStats
                  additions={additions}
                  deletions={deletions}
                  className="leading-none"
                />
              )}
            </span>
          </div>
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover/diff-header:opacity-100 group-focus-within/diff-header:opacity-100">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Open ${file.path}`}
                title="Open file"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenFile();
                }}
                className={REVIEW_HEADER_ACTION_CLASS}
              >
                <ArrowUpRight className="icon-paired" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Toggle file diff"
                aria-expanded={!collapsed}
                data-app-action-review-file-expanded={collapsed ? "false" : "true"}
                data-app-action-review-file-toggle=""
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleCollapsed();
                }}
                className={REVIEW_HEADER_ACTION_CLASS}
              >
                <ChevronDown
                  className={`icon-paired transition-transform duration-200 ${
                    collapsed ? "rotate-0" : "rotate-180"
                  }`}
                />
              </Button>
          </span>
        </div>
      </div>
      {!collapsed && (
        <div className="relative overflow-hidden">
          {children}
        </div>
      )}
    </section>
  );
}

/** Quiet status word (staged / deleted / renamed…) — plain muted text, no pill. */
function GitReviewHeaderChip({ label }: { label: string }) {
  return (
    <span className="text-[length:var(--text-ui-sm)] leading-[var(--text-ui-sm--line-height)] text-sidebar-muted-foreground">
      {label}
    </span>
  );
}

function basenameOf(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}
