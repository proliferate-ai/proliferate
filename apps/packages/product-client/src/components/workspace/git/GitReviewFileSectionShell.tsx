import type { ReactNode } from "react";
import { Button } from "#product/primitives/Button";
import { ArrowUpRight, ChevronDown } from "#product/primitives/icons/core";
import { FileChangeStats } from "#product/components/content/ui/FileChangeStats";
import { FileTreeEntryIcon } from "#product/components/workspace/files/file-icons";
import type { GitPanelReviewFile } from "#product/lib/domain/workspaces/changes/git-panel-diff";

const REVIEW_HEADER_ACTION_CLASS =
  "size-6 shrink-0 rounded-md border-0 bg-transparent p-0 text-sidebar-muted-foreground transition-colors hover:bg-hover hover:text-sidebar-foreground active:bg-active focus-visible:ring-1 focus-visible:ring-sidebar-ring";

/**
 * Flat review-document section: sticky reference-style header (file icon,
 * front-truncated path with dimmed directory, status chip, always-on +N/−N)
 * over the diff body. Replaces the FileDiffCard card look for the git pane.
 *
 * Contradiction, recorded rather than re-derived: spec section 2.4/2.6 call
 * for `Disclosure` to take over this header's collapse/chevron machine.
 * `Disclosure` as landed hardcodes its row paint (`rounded-lg px-2
 * hover:bg-hover active:bg-active`) on its trigger row with no override
 * slot, which cannot host this header's sticky, full-bleed, near-opaque
 * `color-mix` background (a deliberate WKWebView-compositor concession,
 * commented below) without either breaking that visual or fighting the
 * pattern's own paint with a specificity override — itself a new escape
 * hatch of the kind this doctrine forbids. What this file *does* adopt
 * from the ruling: the previous `role="button"` div plus its hand-rolled
 * Enter/Space `onKeyDown` (C3) is replaced with a real button (the `Button`
 * primitive, `variant="unstyled"`) — native
 * Enter/Space and tab order for free, same as `Disclosure`'s own trigger —
 * and the previously-separate "Toggle file diff" chevron button (a second,
 * fully redundant trigger for the exact same `onToggleCollapsed`) is
 * removed; the chevron is now a decorative, non-interactive indicator
 * inside the header's whole-row button, and — matching `Disclosure`'s own
 * always-visible chevron convention, the one piece of that pattern's
 * behavior this file *can* adopt — it is no longer hidden inside the
 * hover-revealed actions span with the rest. Only the "Open file" action
 * (a click target, not a state indicator) keeps the hover-reveal treatment
 * the spec separately rules to leave untouched. This resolves the C3
 * finding and the header's duplicate-trigger defect without forcing an
 * incompatible shape onto the sticky header.
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
      // C4: token-referencing background — the review document's base
      // surface, kept as a raw var() rather than a Tailwind color utility
      // because the diff body underneath composites its own token stack
      // against this exact custom property.
      className="bg-[var(--color-background)]"
    >
      <div
        // Near-opaque color-mix, never backdrop-blur: blur resampling across
        // many sticky headers starves the WKWebView compositor.
        className="sticky top-0 z-10 bg-[color-mix(in_srgb,var(--color-diff-sidebar-file-header-surface)_97%,transparent)]"
      >
        {/* C4: token-referencing hover background — a dedicated diff-header
            hover surface token distinct from the shared `hover-bg` scale, so
            it composites correctly over the sticky header's own near-opaque
            color-mix above without a second color-mix layered on top. */}
        <div className="group/diff-header @container/diff-header flex min-h-8 items-center gap-2 pr-2 text-chat text-sidebar-foreground hover:bg-[var(--color-diff-sidebar-file-header-hover-surface)]">
          <Button
            type="button"
            variant="unstyled"
            size="unstyled"
            aria-expanded={!collapsed}
            data-app-action-review-file-expanded={collapsed ? "false" : "true"}
            onClick={onToggleCollapsed}
            className="flex min-w-0 flex-1 select-none items-center justify-start gap-2 px-3 py-1 text-left"
          >
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
              {/* Stats trail the title directly (reference changes-pane layout),
                  not right-aligned; only hover actions pin to the edge. */}
              <span className="flex shrink-0 items-center gap-1.5">
                {showStagedChip && <GitReviewHeaderChip label="staged" />}
                {statusChip && <GitReviewHeaderChip label={statusChip} />}
                {binary && additions === 0 && deletions === 0 ? (
                  <span className="text-ui-sm text-sidebar-muted-foreground">
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
            {/* Decorative only — no longer its own trigger (see the class
                docstring above). The whole row above is the one real toggle,
                same "single owned trigger" contract Disclosure enforces. */}
            <ChevronDown
              aria-hidden
              className={`icon-paired shrink-0 text-sidebar-muted-foreground transition-transform duration-disclosure ${
                collapsed ? "rotate-0" : "rotate-180"
              }`}
            />
          </Button>
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-hover group-hover/diff-header:opacity-100 group-focus-within/diff-header:opacity-100">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Open ${file.path}`}
                title="Open file"
                onClick={onOpenFile}
                className={REVIEW_HEADER_ACTION_CLASS}
              >
                <ArrowUpRight className="icon-paired" />
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
    <span className="text-ui-sm text-sidebar-muted-foreground">
      {label}
    </span>
  );
}

function basenameOf(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}
