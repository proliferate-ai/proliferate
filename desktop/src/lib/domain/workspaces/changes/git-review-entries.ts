import type {
  GitPanelSection,
  GitPanelReviewFile,
  GitPanelReviewScope,
} from "@/lib/domain/workspaces/changes/git-panel-diff";

export interface GitReviewFileEntry {
  key: string;
  id: string;
  sectionScope: GitPanelReviewScope;
  file: GitPanelReviewFile;
}

export function buildGitReviewFileEntries(
  sections: readonly GitPanelSection[],
): GitReviewFileEntry[] {
  return sections.flatMap((section) =>
    section.files.map((file) => gitReviewEntryForFile(section.scope, file))
  );
}

export function gitReviewEntryForFile(
  sectionScope: GitPanelReviewScope,
  file: GitPanelReviewFile,
): GitReviewFileEntry {
  const key = `file:${sectionScope}:${file.key}`;
  return {
    key,
    id: `git-review-${stableDomId(key)}`,
    sectionScope,
    file,
  };
}

function stableDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
