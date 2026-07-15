/**
 * Fixture changeset for the git-review-v2 playground: a realistic mixed-status
 * branch diff so the redesigned review document can be judged against real
 * shapes (long paths, big and tiny diffs, adds/deletes/renames, binary).
 */

export type GitReviewV2Status =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "binary";

export interface GitReviewV2File {
  key: string;
  path: string;
  oldPath?: string;
  status: GitReviewV2Status;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface GitReviewV2Target {
  id: string;
  label: string;
  description: string;
}

export const GIT_REVIEW_V2_TARGETS: GitReviewV2Target[] = [
  {
    id: "working-tree",
    label: "Working tree",
    description: "Uncommitted changes vs HEAD",
  },
  {
    id: "branch",
    label: "Branch",
    description: "git-review-v2 vs origin/main",
  },
  {
    id: "last-turn",
    label: "Last turn",
    description: "Changes from the agent's last turn",
  },
];

const PATCH_PARSE_STATUS = [
  "@@ -92,14 +92,24 @@ impl StatusParser {",
  "     fn entry_from_porcelain(&self, line: &str) -> Option<GitChangedFile> {",
  "         let (code, path) = split_porcelain_line(line)?;",
  "         let status = classify_status_code(code);",
  "-        Some(GitChangedFile {",
  "-            path: path.to_owned(),",
  "-            status,",
  "-            additions: 0,",
  "-            deletions: 0,",
  "-        })",
  "+        let numstat = self.numstat_index.get(path);",
  "+        Some(GitChangedFile {",
  "+            path: path.to_owned(),",
  "+            status,",
  "+            additions: numstat.map(|n| n.additions).unwrap_or(0),",
  "+            deletions: numstat.map(|n| n.deletions).unwrap_or(0),",
  "+        })",
  "     }",
  " ",
  "+    /// Line counts come from a single `git diff --numstat` pass so the",
  "+    /// changed-file list carries real totals without per-file diff fetches.",
  "+    fn build_numstat_index(&mut self, raw: &str) {",
  "+        for line in raw.lines() {",
  "+            if let Some(entry) = parse_numstat_line(line) {",
  "+                self.numstat_index.insert(entry.path.clone(), entry);",
  "+            }",
  "+        }",
  "+    }",
  " }",
].join("\n");

const PATCH_DIFF_SUPPORT = [
  "@@ -178,11 +178,16 @@ pub fn changed_files_for_range(",
  "     let output = run_git(repo, &[\"diff\", \"--name-status\", range])?;",
  "     let mut files = parse_name_status(&output)?;",
  "-    for file in &mut files {",
  "-        file.additions = 0;",
  "-        file.deletions = 0;",
  "-    }",
  "+    let numstat = run_git(repo, &[\"diff\", \"--numstat\", range])?;",
  "+    let index = build_numstat_index(&numstat);",
  "+    for file in &mut files {",
  "+        if let Some(entry) = index.get(&file.path) {",
  "+            file.additions = entry.additions;",
  "+            file.deletions = entry.deletions;",
  "+        }",
  "+    }",
  "     Ok(files)",
  " }",
].join("\n");

const PATCH_GIT_PANEL = [
  "@@ -96,38 +96,12 @@ export function GitPanelContent() {",
  "   const [layout, setLayout] = useState<DiffLayout>(\"unified\");",
  "-  const [filterMode, setFilterMode] = useState<GitPanelFilterMode>(",
  "-    \"working_tree_composite\",",
  "-  );",
  "-  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());",
  "-  const autoCollapsedFiles = useMemo(() => {",
  "-    if (userInteracted) return collapsedFiles;",
  "-    return new Set(files.map((file) => file.key));",
  "-  }, [collapsedFiles, files, userInteracted]);",
  "+  const [target, setTarget] = useState<GitReviewTarget>(\"working-tree\");",
  "+  const collapse = useReviewCollapseState(files);",
  "   const state = useGitPanelState(mode, options);",
  "   return (",
  "     <div className=\"flex h-full flex-col\">",
  "-      <GitPanelHeader",
  "-        filterMode={filterMode}",
  "-        onFilterModeChange={setFilterMode}",
  "-        tabs={GIT_PANEL_FILTER_TABS}",
  "-      />",
  "-      <GitPanelReviewSections sections={state.sections} />",
  "+      <GitReviewHeader target={target} onTargetChange={setTarget} />",
  "+      <GitReviewDocument files={state.files} collapse={collapse} />",
  "     </div>",
  "   );",
  " }",
].join("\n");

const PATCH_REVIEW_DOCUMENT = [
  "@@ -0,0 +1,48 @@",
  "+import { useRef } from \"react\";",
  "+import { GitReviewFileSection } from \"./GitReviewFileSection\";",
  "+",
  "+/**",
  "+ * Flat review document: one scroll container stacking per-file sections",
  "+ * with sticky headers. No cards, no section boxes — navigation happens",
  "+ * by scrolling, jump-to-file, and collapse-all.",
  "+ */",
  "+export function GitReviewDocument({ files, collapse }: GitReviewDocumentProps) {",
  "+  const scrollRef = useRef<HTMLDivElement>(null);",
  "+  return (",
  "+    <div ref={scrollRef} className=\"min-h-0 flex-1 overflow-y-auto\">",
  "+      <div className=\"flex flex-col gap-0.5\">",
  "+        {files.map((file) => (",
  "+          <GitReviewFileSection",
  "+            key={file.key}",
  "+            file={file}",
  "+            isCollapsed={collapse.isCollapsed(file.key)}",
  "+            onToggle={() => collapse.toggle(file.key)}",
  "+          />",
  "+        ))}",
  "+      </div>",
  "+    </div>",
  "+  );",
  "+}",
].join("\n");

const PATCH_STATUS_BADGE = [
  "@@ -1,21 +0,0 @@",
  "-import { getGitFileStatusPresentation } from \"#product/lib/domain/workspaces/changes/git-file-status-presentation\";",
  "-",
  "-export function GitReviewStatusBadge({ status }: { status: GitFileStatus }) {",
  "-  const presentation = getGitFileStatusPresentation(status);",
  "-  return (",
  "-    <span",
  "-      title={presentation.title}",
  "-      className={`inline-flex h-4 min-w-4 items-center justify-center rounded px-1 ${presentation.className}`}",
  "-    >",
  "-      {presentation.label}",
  "-    </span>",
  "-  );",
  "-}",
].join("\n");

const PATCH_RENAMED_SECTION = [
  "@@ -70,8 +70,8 @@ interface GitReviewFileSectionProps {",
  "   file: GitPanelFile;",
  "-  fetchDiff: boolean;",
  "-  surface: \"sidebar\";",
  "+  isCollapsed: boolean;",
  "+  onToggle: () => void;",
  "   layout: DiffLayout;",
  " }",
].join("\n");

const PATCH_SPEC = [
  "@@ -19,9 +19,12 @@ ## Changes is the changed-file workflow",
  " The Changes surface reviews workspace edits before commit.",
  "-Files render as collapsible cards grouped into staged/unstaged",
  "-sections behind filter tabs.",
  "+Files render as one flat review document: per-file sections with",
  "+sticky headers, expanded by default, +N/−N counts always visible.",
  "+The header target menu picks what the review diffs against",
  "+(working tree, branch vs base, last turn).",
  " ",
  "+Staging decisions live in the commit flow, not the review pane.",
].join("\n");

const PATCH_USE_COLLAPSE = [
  "@@ -0,0 +1,9 @@",
  "+export function useReviewCollapseState(files: GitPanelFile[]) {",
  "+  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());",
  "+  return {",
  "+    isCollapsed: (key: string) => collapsed.has(key),",
  "+    toggle: (key: string) => setCollapsed(toggleInSet(key)),",
  "+    collapseAll: () => setCollapsed(new Set(files.map((f) => f.key))),",
  "+    expandAll: () => setCollapsed(new Set()),",
  "+  };",
  "+}",
].join("\n");

export const GIT_REVIEW_V2_FILES: GitReviewV2File[] = [
  {
    key: "parse-status",
    path: "anyharness/crates/anyharness-lib/src/adapters/git/parse_status.rs",
    status: "modified",
    additions: 24,
    deletions: 12,
    patch: PATCH_PARSE_STATUS,
  },
  {
    key: "diff-support",
    path: "anyharness/crates/anyharness-lib/src/operations/diff_support.rs",
    status: "modified",
    additions: 16,
    deletions: 5,
    patch: PATCH_DIFF_SUPPORT,
  },
  {
    key: "git-panel",
    path: "apps/packages/product-client/src/components/workspace/git/GitPanel.tsx",
    status: "modified",
    additions: 42,
    deletions: 118,
    patch: PATCH_GIT_PANEL,
  },
  {
    key: "review-document",
    path: "apps/packages/product-client/src/components/workspace/git/GitReviewDocument.tsx",
    status: "added",
    additions: 148,
    deletions: 0,
    patch: PATCH_REVIEW_DOCUMENT,
  },
  {
    key: "use-collapse",
    path: "apps/packages/product-client/src/hooks/workspaces/ui/git/use-review-collapse-state.ts",
    status: "added",
    additions: 36,
    deletions: 0,
    patch: PATCH_USE_COLLAPSE,
  },
  {
    key: "status-badge",
    path: "apps/packages/product-client/src/components/workspace/git/GitReviewStatusBadge.tsx",
    status: "deleted",
    additions: 0,
    deletions: 46,
    patch: PATCH_STATUS_BADGE,
  },
  {
    key: "file-section",
    path: "apps/packages/product-client/src/components/workspace/git/GitReviewFileSection.tsx",
    oldPath: "apps/packages/product-client/src/components/workspace/git/GitReviewFileRow.tsx",
    status: "renamed",
    additions: 8,
    deletions: 8,
    patch: PATCH_RENAMED_SECTION,
  },
  {
    key: "spec",
    path: "specs/codebase/features/workspace-files.md",
    status: "modified",
    additions: 12,
    deletions: 3,
    patch: PATCH_SPEC,
  },
  {
    key: "binary-icon",
    path: "apps/packages/product-client/src-tauri/app-icons/vscode.png",
    status: "binary",
    additions: 0,
    deletions: 0,
    patch: null,
  },
];

export const GIT_REVIEW_V2_BRANCH = {
  local: "git-review-v2",
  remote: "origin/main",
};
