#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const referenceRoot = process.env.FILE_UI_REFERENCE_DIR
  ? path.resolve(process.env.FILE_UI_REFERENCE_DIR)
  : path.join(os.homedir(), "proliferate", "reference", "codex");

const inputs = {
  referenceSearch: path.join(referenceRoot, "files", "file_search_2.html"),
  referenceView: path.join(referenceRoot, "files", "files_view.html"),
  referenceStyles: path.join(referenceRoot, "styles.css"),
  overlay: path.join(
    repoRoot,
    "desktop/src/components/workspace/chat/surface/SessionContentSearchOverlay.tsx",
  ),
  chatView: path.join(repoRoot, "desktop/src/components/workspace/chat/ChatView.tsx"),
  shortcuts: path.join(repoRoot, "desktop/src/config/shortcuts.ts"),
  fileFrame: path.join(
    repoRoot,
    "desktop/src/components/workspace/files/viewer/FileViewerFrame.tsx",
  ),
  fileBrowserOverlay: path.join(
    repoRoot,
    "desktop/src/components/workspace/files/viewer/WorkspaceFileBrowserOverlay.tsx",
  ),
  fileEditor: path.join(
    repoRoot,
    "desktop/src/components/workspace/files/FileEditorView.tsx",
  ),
  fileSource: path.join(
    repoRoot,
    "desktop/src/components/workspace/files/viewer/FileSourceView.tsx",
  ),
  diffViewer: path.join(
    repoRoot,
    "desktop/src/components/ui/content/diff/ChatDiffViewer.tsx",
  ),
  diffLineContent: path.join(
    repoRoot,
    "desktop/src/components/ui/content/diff/DiffLineContent.tsx",
  ),
  marks: path.join(
    repoRoot,
    "desktop/src/components/ui/content/search/ContentSearchMarks.tsx",
  ),
  store: path.join(repoRoot, "desktop/src/stores/search/content-search-store.ts"),
  contentSearch: path.join(
    repoRoot,
    "desktop/src/lib/domain/content-search/content-search.ts",
  ),
  paneSideOverlay: path.join(
    repoRoot,
    "desktop/src/components/workspace/pane/PaneSideOverlay.tsx",
  ),
  css: path.join(repoRoot, "desktop/src/index.css"),
};

function read(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    return { error };
  }
}

const source = Object.fromEntries(
  Object.entries(inputs).map(([key, file]) => [key, read(file)]),
);

const checks = [];

function includesAll(text, fragments) {
  if (typeof text !== "string") {
    return false;
  }
  return fragments.every((fragment) => text.includes(fragment));
}

function addCheck(section, name, referenceOk, oursOk, details = "") {
  checks.push({
    section,
    name,
    referenceOk,
    oursOk,
    ok: Boolean(referenceOk && oursOk),
    details,
  });
}

for (const [key, value] of Object.entries(source)) {
  addCheck(
    "inputs",
    key,
    true,
    typeof value === "string",
    typeof value === "string" ? inputs[key] : `${inputs[key]}: ${value.error.message}`,
  );
}

addCheck(
  "content search overlay",
  "anchored pane-locally with reference offsets and z-index",
  includesAll(source.referenceSearch, [
    "pointer-events-none fixed top-2 right-4 z-[55] flex justify-end",
  ]),
  includesAll(source.overlay, [
    "data-content-search-overlay",
    "data-content-search-surface",
    "pointer-events-none absolute top-2 right-4 z-[55] flex justify-end",
  ]),
);

addCheck(
  "content search overlay",
  "panel geometry matches the 340px Codex shell",
  includesAll(source.referenceSearch, [
    "grid w-[340px] max-w-[70vw] grid-cols-[minmax(0,1fr)_auto_auto]",
    "overflow-hidden rounded-[20px]",
    "shadow-[0px_8px_16px_-4px_rgba(0,0,0,0.12)]",
  ]),
  includesAll(source.overlay, [
    "grid w-[340px] max-w-[70vw]",
    "grid-cols-[minmax(0,1fr)_auto_auto]",
    "overflow-hidden rounded-[20px]",
    "shadow-[0px_8px_16px_-4px_rgba(0,0,0,0.12)]",
  ]),
);

addCheck(
  "content search overlay",
  "panel uses the reference half-pixel border treatment",
  includesAll(source.referenceSearch, ["border-[0.5px] border-token-border"]),
  includesAll(source.overlay, ["border-[0.5px] border-border"]),
);

addCheck(
  "content search overlay",
  "input id, surface-aware accessible label, and diff placeholder mirror the reference",
  includesAll(source.referenceSearch, [
    'id="content-search-input"',
    'aria-label="Find in chat"',
    "Search diff",
  ]),
  includesAll(source.overlay, [
    'id="content-search-input"',
    'surface === "file" ? "Find in file" : "Find in chat"',
    "Search diff",
  ]),
);

addCheck(
  "content search overlay",
  "chat overlay scope buttons and result controls keep the reference labels",
  includesAll(source.referenceSearch, [
    'aria-label="Search chat"',
    'aria-label="Search diffs"',
    'aria-label="Previous result"',
    'aria-label="Next result"',
    'aria-label="Close find"',
  ]),
  includesAll(source.overlay, [
    'label="Search chat"',
    'label="Search diffs"',
    'label="Previous result"',
    'label="Next result"',
    'aria-label="Close find"',
  ]),
);

addCheck(
  "content search overlay",
  "file overlay omits chat/diff scope controls",
  true,
  includesAll(source.overlay, [
    'const showScopeButtons = surface === "chat"',
    "grid-cols-[minmax(0,1fr)_auto]",
    "Search file",
  ]),
);

addCheck(
  "content search overlay",
  "active match scrolling retries once for virtualized file rows",
  true,
  includesAll(source.overlay, [
    "scrollActiveMatchIntoView",
    "window.requestAnimationFrame(scrollActiveMatchIntoView)",
  ]),
);

addCheck(
  "content search overlay",
  "expanded result row includes the Codex max-height/opacity transition states",
  includesAll(source.referenceSearch, [
    "transition-[border-width,max-height,opacity,padding,translate]",
    "max-h-9 translate-y-0 border-t py-2 opacity-100",
    "/ 11 results",
  ]),
  includesAll(source.overlay, [
    "transition-[border-width,max-height,opacity,padding,translate]",
    "max-h-9",
    "translate-y-0",
    "border-t",
    "py-2",
    "opacity-100",
    "${activeMatchIndex + 1} / ${matchCount} results",
  ]),
);

addCheck(
  "content search wiring",
  "shortcut opens session content search from inputs",
  true,
  includesAll(source.shortcuts, [
    'id: "workspace.find-content"',
    "allowInInputs: true",
    'match: { kind: "fixed", key: "f", meta: true',
  ]),
);

addCheck(
  "content search wiring",
  "overlay is mounted inside the chat/session surface",
  true,
  includesAll(source.chatView, [
    "SessionContentSearchOverlay",
    "shouldEnableContentSearchOverlay",
    "enabled={contentSearchEnabled}",
    'surface="chat"',
  ]),
);

addCheck(
  "content search wiring",
  "file toolbar owns a pane-local content-search surface",
  true,
  includesAll(source.fileFrame, [
    "relative flex h-full",
    "data-file-viewer-frame",
    "SessionContentSearchOverlay",
    "enabled",
    'surface="file"',
  ]) && includesAll(source.fileEditor, [
    'openContentSearch("diffs", "file")',
    "onOpenContentSearch={openFindInDiffs}",
  ]),
);

addCheck(
  "content search wiring",
  "find shortcut routes to the file pane when focus is inside a file viewer",
  true,
  includesAll(source.overlay, [
    "resolveContentSearchSurfaceForShortcut",
    'closest("[data-file-viewer-frame]")',
    'getFocusZone() === "right-panel"',
    'return "file"',
  ]),
);

addCheck(
  "content search marks",
  "mark classes mirror Codex find highlight semantics",
  includesAll(source.referenceStyles, [
    "mark.codex-thread-find-match",
    "background-color: var(--vscode-charts-yellow)",
    "mark.codex-thread-find-active",
    "background-color: var(--vscode-charts-orange)",
  ]),
  includesAll(source.css, [
    "mark.codex-thread-find-match",
    "background-color: var(--color-terminal-yellow)",
    "mark.codex-thread-find-active",
  ]) && includesAll(source.marks, [
    "codex-thread-find-match",
    "codex-thread-find-active",
    "data-content-search-match-id",
  ]),
);

addCheck(
  "content search marks",
  "diff and file source renderers wrap visible text with searchable marks",
  true,
  includesAll(source.diffLineContent, [
    "renderContentSearchMarkedText",
    "contentSearchLineId",
    "activeMatchId",
  ]) && includesAll(source.fileSource, [
    "renderContentSearchMarkedText",
    "contentSearchUnitId",
    "activeMatchId",
  ]),
);

addCheck(
  "content search domain",
  "match counting is pure domain logic outside React",
  true,
  includesAll(source.contentSearch, [
    "findContentSearchMatches",
    "countContentSearchTokenMatches",
    "buildContentSearchLineMatchIds",
  ]) && includesAll(source.store, [
    "registerUnit",
    "goToNextMatch",
    "goToPreviousMatch",
  ]),
);

addCheck(
  "content search domain",
  "visible matches are isolated by pane surface",
  true,
  includesAll(source.store, [
    "ContentSearchSurface",
    "surface: ContentSearchSurface",
    "openSearch: (scope?: ContentSearchScope, surface?: ContentSearchSurface)",
    "unit.surface === state.surface",
  ]) && includesAll(source.fileSource, [
    'contentSearchSurface === "file"',
    'surface: "file"',
  ]) && includesAll(source.diffViewer, [
    'contentSearchSurface === "chat"',
    'surface: "chat"',
  ]),
);

addCheck(
  "file viewer toolbar",
  "toolbar matches the reference single-row file path nav shape",
  includesAll(source.referenceView, [
    "h-toolbar-pane",
    "flex-row-reverse",
    'aria-label="File path"',
  ]),
  includesAll(source.fileFrame, [
    "data-file-viewer-toolbar",
    "flex h-10 min-h-10 shrink-0 items-center",
    "flex-row-reverse",
    'aria-label="File path"',
  ]),
);

addCheck(
  "file viewer toolbar",
  "workspace path-search modal is removed from the file viewer flow",
  true,
  !source.fileFrame.includes("Search files") &&
    !source.fileEditor.includes("WorkspaceFileSearchModal"),
);

addCheck(
  "file viewer toolbar",
  "toolbar search icon opens the pane-local content-search overlay",
  true,
  includesAll(source.fileFrame, [
    "Search",
    'label="Find in file"',
    "onOpenContentSearch",
  ]) && includesAll(source.fileEditor, [
    'openContentSearch("diffs", "file")',
    "onOpenContentSearch={openFindInDiffs}",
  ]),
);

addCheck(
  "file browser overlay",
  "file browser uses the same right-side pane overlay as the git file tree",
  true,
  includesAll(source.paneSideOverlay, [
    "data-pane-side-overlay",
    "absolute bottom-2 right-2 top-2",
  ]) && includesAll(source.fileBrowserOverlay, [
    "PaneSideOverlay",
    'label="Browse files"',
    'widthClassName="w-[min(320px,calc(100%-1rem))]"',
    'dataAttribute="file-browser-overlay"',
  ]) && !source.fileBrowserOverlay.includes("ModalShell"),
);

addCheck(
  "file viewer toolbar",
  "toolbar actions use compact icon buttons like the reference",
  includesAll(source.referenceView, [
    'aria-label="File viewer options"',
    'aria-label="Open in editor"',
    "h-token-button-composer",
  ]),
  includesAll(source.fileFrame, [
    'label="File viewer options"',
    'label="Open in default editor"',
    "size-7 rounded-lg",
  ]),
);

addCheck(
  "file source structure",
  "source pre/code expose the same diff/file data attributes",
  includesAll(source.referenceView, [
    "pre data-file",
    "data-overflow=\"scroll\"",
  ]) || includesAll(source.referenceSearch, ["[data-file]"]),
  includesAll(source.fileSource, [
    "data-file",
    "data-code",
    'data-overflow="scroll"',
  ]),
);

addCheck(
  "file source structure",
  "line rows use Codex data-gutter/data-content contract",
  includesAll(source.referenceView, [
    "[data-gutter]",
    "[data-column-number]",
    "[data-line-number-content]",
  ]) || includesAll(source.referenceSearch, [
    "[data-gutter]",
    "[data-column-number]",
  ]),
  includesAll(source.fileSource, [
    "data-gutter=\"\"",
    "data-content=\"\"",
    "data-column-number={lineNumber}",
    "data-line-number-content=\"\"",
    "data-line-type=\"context\"",
  ]),
);

addCheck(
  "file source structure",
  "gutter width uses the shared diffs column-number variable",
  includesAll(source.referenceSearch, ["--diffs-column-number-width"]),
  includesAll(source.fileSource, [
    "--diffs-column-number-width",
    "grid-cols-[var(--diffs-column-number-width)",
  ]) && includesAll(source.diffViewer, ["--diffs-column-number-width"]),
);

addCheck(
  "file source structure",
  "virtualized source view scrolls active find matches into the rendered window",
  true,
  includesAll(source.fileSource, [
    "activeMatchId?.startsWith",
    "virtualizer.scrollToIndex",
    "{ align: \"center\" }",
  ]),
);

addCheck(
  "file source styling",
  "source surface is flat, token-backed, and not boxed with decorative gutters",
  includesAll(source.referenceSearch, [
    "--codex-diffs-surface",
    "--diffs-bg",
    "background-color: var(--color-token-main-surface-primary)",
  ]),
  includesAll(source.css, [
    ".file-source-view",
    "--codex-diffs-surface: var(--color-background)",
    "--diffs-bg: var(--codex-diffs-surface)",
  ]) &&
    !source.css.includes(".file-source-line-number::after") &&
    !source.css.includes("gutter-shadow"),
);

const failed = checks.filter((check) => !check.ok);
const grouped = checks.reduce((accumulator, check) => {
  accumulator[check.section] ??= [];
  accumulator[check.section].push(check);
  return accumulator;
}, {});

for (const [section, sectionChecks] of Object.entries(grouped)) {
  console.log(`\n${section}`);
  for (const check of sectionChecks) {
    const status = check.ok ? "PASS" : "FAIL";
    console.log(`  ${status} ${check.name}`);
    if (!check.ok && check.details) {
      console.log(`       ${check.details}`);
    }
  }
}

console.log(
  `\n${checks.length - failed.length}/${checks.length} checks passed against ${referenceRoot}`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
