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

export function canPreviewAsSvg(path: string): boolean {
  return path.split(/[\\/]/).pop()?.toLowerCase().endsWith(".svg") ?? false;
}

export function canPreviewAsRichFile(path: string): boolean {
  return canPreviewAsMarkdown(path) || canPreviewAsSvg(path);
}
