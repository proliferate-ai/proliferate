const MARKDOWN_PREVIEW_EXTENSIONS = new Set([
  "md",
  "mdx",
  "markdown",
  "mdown",
  "mkd",
]);

const COMMON_PREVIEW_FILE_STEMS = new Set([
  "authors",
  "changelog",
  "changes",
  "code_of_conduct",
  "contributing",
  "contributors",
  "copying",
  "governance",
  "history",
  "licence",
  "license",
  "notice",
  "readme",
  "security",
  "support",
]);

export function canPreviewAsMarkdown(path: string): boolean {
  const basename = path.split(/[\\/]/).filter(Boolean).pop()?.toLowerCase() ?? "";
  if (!basename) {
    return false;
  }

  const extension = basename.includes(".") ? basename.split(".").pop() ?? "" : "";
  if (MARKDOWN_PREVIEW_EXTENSIONS.has(extension)) {
    return true;
  }

  const stem = basename.split(".")[0] ?? basename;
  if (COMMON_PREVIEW_FILE_STEMS.has(stem)) {
    return true;
  }

  return stem.startsWith("license-") || stem.startsWith("licence-");
}
