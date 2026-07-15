import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CollapseAll,
  ExpandAll,
  FolderTree,
  GitCommit,
  MoreHorizontal,
} from "@proliferate/ui/icons";
import { DiffViewer } from "@/components/content/ui/DiffViewer";
import { FileChangeStats } from "@/components/content/ui/FileChangeStats";
import { FileTreeEntryIcon } from "@/components/workspace/files/file-icons";
import {
  GIT_REVIEW_V2_BRANCH,
  GIT_REVIEW_V2_FILES,
  GIT_REVIEW_V2_TARGETS,
  type GitReviewV2File,
} from "@/lib/domain/chat/__fixtures__/playground/git-review-v2-fixtures";

/**
 * Visual spec for the git review redesign (Codex diff-pane parity, our
 * tokens). Playground-only: static fixtures, no production imports beyond
 * shared atoms. The pane is one flat review document — per-file sections
 * with sticky headers, expanded by default — replacing the card grid and
 * filter tabs.
 */

const PANE_WIDTHS = [320, 380, 480, 640] as const;

// Same near-opaque sticky recipe as FileDiffCard sidebar headers: color-mix,
// never backdrop-blur (blur across many sticky headers starves the WKWebView
// compositor).
const SECTION_STYLE = {
  // Unchanged lines sit on the plain pane background — only +/- rows carry a
  // tint (Pablo ruling, diverges from Codex's 94% context mix). In mono dark
  // --color-diff-surface is itself the light context mix; the dominant dark
  // everything else uses is --color-background.
  backgroundColor: "var(--color-background)",
  "--diffs-bg-context-override": "var(--color-background)",
  "--codex-diffs-context-number": "var(--color-background)",
} as CSSProperties;
const STICKY_HEADER_CLASS =
  "sticky top-0 z-10 cursor-pointer select-none bg-[color-mix(in_srgb,var(--color-diff-sidebar-file-header-surface)_97%,transparent)]";

export function GitReviewV2Playground() {
  const [paneWidth, setPaneWidth] = useState<number>(380);

  return (
    <div className="flex h-screen flex-col items-center gap-3 overflow-hidden bg-background py-4 text-foreground">
      <div className="flex shrink-0 items-center gap-2 text-[length:var(--text-ui)] text-muted-foreground">
        <span>git-review-v2 playground · pane width</span>
        {PANE_WIDTHS.map((width) => (
          <Button
            key={width}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPaneWidth(width)}
            className={`h-6 rounded-md px-2 text-[length:var(--text-ui)] ${
              paneWidth === width
                ? "bg-list-hover text-foreground"
                : "text-muted-foreground"
            }`}
          >
            {width}
          </Button>
        ))}
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-sidebar-background text-sidebar-foreground shadow-md"
        style={{ width: paneWidth }}
      >
        <GitReviewV2Pane />
      </div>
    </div>
  );
}

function GitReviewV2Pane() {
  const [targetId, setTargetId] = useState("branch");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const target =
    GIT_REVIEW_V2_TARGETS.find((entry) => entry.id === targetId)
    ?? GIT_REVIEW_V2_TARGETS[0];
  const allCollapsed = collapsed.size >= GIT_REVIEW_V2_FILES.length;
  const totals = useMemo(
    () =>
      GIT_REVIEW_V2_FILES.reduce(
        (acc, file) => ({
          additions: acc.additions + file.additions,
          deletions: acc.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [],
  );

  const toggleFile = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleAll = () => {
    setCollapsed(
      allCollapsed
        ? new Set()
        : new Set(GIT_REVIEW_V2_FILES.map((file) => file.key)),
    );
  };

  const jumpToFile = (key: string) => {
    scrollRef.current
      ?.querySelector(`[data-review-section="${key}"]`)
      ?.scrollIntoView({ block: "start" });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ReviewHeader
        targetLabel={target.label}
        targetId={targetId}
        onTargetChange={setTargetId}
        totals={totals}
        allCollapsed={allCollapsed}
        onToggleAll={toggleAll}
        onJumpToFile={jumpToFile}
      />
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-3"
      >
        <div className="flex flex-col gap-0.5">
          {GIT_REVIEW_V2_FILES.map((file) => (
            <ReviewFileSection
              key={file.key}
              file={file}
              isCollapsed={collapsed.has(file.key)}
              onToggle={() => toggleFile(file.key)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ReviewHeader({
  targetLabel,
  targetId,
  onTargetChange,
  totals,
  allCollapsed,
  onToggleAll,
  onJumpToFile,
}: {
  targetLabel: string;
  targetId: string;
  onTargetChange: (id: string) => void;
  totals: { additions: number; deletions: number };
  allCollapsed: boolean;
  onToggleAll: () => void;
  onJumpToFile: (key: string) => void;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-0.5 border-b border-sidebar-border/70 px-2 py-1.5">
      <div className="flex items-center gap-1">
        <PopoverButton
          align="start"
          className={`w-64 ${POPOVER_SURFACE_CLASS}`}
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 gap-1 rounded-md px-1.5 text-[length:var(--text-ui)] font-medium text-sidebar-foreground hover:bg-sidebar-accent"
            >
              {targetLabel}
              <ChevronDown className="size-3 text-sidebar-muted-foreground" />
            </Button>
          }
        >
          {(close) => (
            <div className="flex flex-col gap-px">
              {GIT_REVIEW_V2_TARGETS.map((entry) => (
                <PopoverMenuItem
                  key={entry.id}
                  label={entry.label}
                  trailing={entry.id === targetId ? <Check className="size-3.5" /> : null}
                  onClick={() => {
                    onTargetChange(entry.id);
                    close();
                  }}
                >
                  {entry.description}
                </PopoverMenuItem>
              ))}
            </div>
          )}
        </PopoverButton>
        <FileChangeStats
          additions={totals.additions}
          deletions={totals.deletions}
          className="text-chat leading-none"
        />
        <div className="ms-auto flex items-center gap-0.5">
          <PopoverButton
            align="end"
            className={`w-72 ${POPOVER_SURFACE_CLASS}`}
            trigger={
              <HeaderIconButton label="Jump to file">
                <FolderTree className="size-3.5" />
              </HeaderIconButton>
            }
          >
            {(close) => (
              <div className="flex max-h-80 flex-col gap-px overflow-y-auto">
                {GIT_REVIEW_V2_FILES.map((file) => (
                  <PopoverMenuItem
                    key={file.key}
                    density="compact"
                    icon={
                      <FileTreeEntryIcon
                        name={basename(file.path)}
                        path={file.path}
                        kind="file"
                        className="size-3.5 shrink-0"
                      />
                    }
                    label={
                      <span className="min-w-0 truncate">{basename(file.path)}</span>
                    }
                    trailing={
                      <FileChangeStats
                        additions={file.additions}
                        deletions={file.deletions}
                        className="text-[length:var(--text-ui-sm)]"
                      />
                    }
                    onClick={() => {
                      onJumpToFile(file.key);
                      close();
                    }}
                  />
                ))}
              </div>
            )}
          </PopoverButton>
          <HeaderIconButton
            label={allCollapsed ? "Expand all diffs" : "Collapse all diffs"}
            onClick={onToggleAll}
          >
            {allCollapsed ? (
              <ExpandAll className="size-3.5" />
            ) : (
              <CollapseAll className="size-3.5" />
            )}
          </HeaderIconButton>
          <HeaderIconButton label="Review options">
            <MoreHorizontal className="size-3.5" />
          </HeaderIconButton>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="flex min-w-0 items-center gap-1 truncate text-[length:var(--text-ui)] text-sidebar-muted-foreground">
          <span className="truncate">{GIT_REVIEW_V2_BRANCH.local}</span>
          <span aria-hidden="true" className="shrink-0">→</span>
          <span className="truncate">{GIT_REVIEW_V2_BRANCH.remote}</span>
        </span>
        <CommitSplitButton />
      </div>
    </div>
  );
}

function HeaderIconButton({
  label,
  onClick,
  children,
  ref,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  // Forwarded so PopoverButton triggers can anchor to the underlying element.
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="size-6 rounded-md text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
    >
      {children}
    </Button>
  );
}

function CommitSplitButton() {
  return (
    <div className="ms-auto flex shrink-0 items-center">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 gap-1 rounded-md rounded-e-none border border-e-0 border-sidebar-border bg-sidebar-background px-2 text-[length:var(--text-ui)] text-sidebar-foreground hover:bg-sidebar-accent"
      >
        <GitCommit className="size-3.5" />
        Commit or push
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="More git actions"
        className="h-6 w-5 rounded-md rounded-s-none border border-sidebar-border bg-sidebar-background px-0 text-sidebar-muted-foreground hover:bg-sidebar-accent"
      >
        <ChevronDown className="size-3" />
      </Button>
    </div>
  );
}

function ReviewFileSection({
  file,
  isCollapsed,
  onToggle,
}: {
  file: GitReviewV2File;
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  const name = basename(file.path);
  const dir = file.path.slice(0, file.path.length - name.length);

  return (
    <section data-review-section={file.key} style={SECTION_STYLE}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (
            event.target === event.currentTarget
            && (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            onToggle();
          }
        }}
        className={STICKY_HEADER_CLASS}
      >
        <div className="group/diff-header @container/diff-header flex min-h-8 items-center gap-2 px-3 py-1 text-chat leading-[var(--text-chat--line-height)] hover:bg-[var(--color-diff-sidebar-file-header-hover-surface)]">
          {/* Codex path recipe (mirrors FileDiffCard): the GROWING flex item
              is this container; the name span inside is content-sized, so
              every row's name is left-anchored beside the icon. The name's
              [direction:rtl] front-truncates overflow so the basename (the
              tail) always stays visible. */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <FileTreeEntryIcon
              name={name}
              path={file.path}
              kind="file"
              className="size-4 shrink-0"
            />
            <span
              className="min-w-0 truncate [direction:rtl]"
              title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
            >
              <span className="min-w-0 truncate [direction:ltr] [unicode-bidi:plaintext] @xs/diff-header:hidden">
                {name}
              </span>
              <span className="hidden min-w-0 truncate [direction:ltr] [unicode-bidi:plaintext] @xs/diff-header:inline">
                <span className="text-sidebar-muted-foreground">{dir}</span>
                <span className="text-sidebar-foreground">{name}</span>
              </span>
            </span>
          </div>
          <span className="flex shrink-0 items-center gap-1.5">
            {(file.status === "deleted" || file.status === "renamed") && (
              <span className="rounded bg-sidebar-accent px-1 py-px text-[length:var(--text-ui-sm)] leading-[var(--text-ui-sm--line-height)] text-sidebar-muted-foreground">
                {file.status}
              </span>
            )}
            {file.status === "binary" ? (
              <span className="text-[length:var(--text-ui-sm)] text-sidebar-muted-foreground">
                binary
              </span>
            ) : (
              <FileChangeStats
                additions={file.additions}
                deletions={file.deletions}
                className="leading-none"
              />
            )}
            <span className="flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover/diff-header:opacity-100 group-focus-within/diff-header:opacity-100">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Open ${file.path}`}
                title="Open file"
                onClick={(event) => event.stopPropagation()}
                className="size-6 rounded-md text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                <ArrowUpRight className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Toggle file diff"
                aria-expanded={!isCollapsed}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggle();
                }}
                className="size-6 rounded-md text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                <ChevronDown
                  className={`size-3.5 transition-transform duration-200 ${
                    isCollapsed ? "rotate-0" : "rotate-180"
                  }`}
                />
              </Button>
            </span>
          </span>
        </div>
      </div>
      {!isCollapsed && (
        <div className="relative overflow-hidden">
          {file.patch ? (
            <DiffViewer
              patch={file.patch}
              filePath={file.path}
              variant="chat"
              chainVerticalWheel
            />
          ) : (
            <p className="px-3 py-2 text-[length:var(--text-ui)] text-sidebar-muted-foreground">
              Binary file changed
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function basename(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}
