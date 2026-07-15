import { getFileVisual, type FileVisualKind } from "@/lib/domain/files/file-visuals";

/**
 * Codex-style per-filetype icon tints for the file tree overlay.
 * Reuses the vendored Material Icon Theme glyphs from FileTreeEntryIcon and
 * tints them with existing theme color tokens (no new palette entries).
 * Kinds not listed fall back to the default monochrome file-icon tones.
 */
const ICON_COLOR_BY_KIND: Partial<Record<FileVisualKind, string>> = {
  "typescript": "text-terminal-blue",
  "typescript-def": "text-terminal-blue",
  "tsconfig": "text-terminal-blue",
  "react-ts": "text-terminal-blue",
  "test-ts": "text-terminal-blue",
  "javascript": "text-git-yellow",
  "react": "text-terminal-blue",
  "test-js": "text-git-yellow",
  "test-jsx": "text-git-yellow",
  "css": "text-terminal-magenta",
  "sass": "text-terminal-magenta",
  "markdown": "text-git-green",
  "readme": "text-git-green",
  "json": "text-git-yellow",
  "html": "text-git-red",
  "svg": "text-git-yellow",
  "image": "text-git-yellow",
  "git": "text-git-red",
  "yaml": "text-terminal-magenta",
  "python": "text-terminal-blue",
  "rust": "text-git-red",
  "go": "text-terminal-blue",
  "shell": "text-git-green",
  "docker": "text-terminal-blue",
};

export function fileTreeIconToneClass(
  name: string,
  path: string,
  kind: string,
): string | undefined {
  if (kind === "directory") {
    return undefined;
  }
  const visual = getFileVisual(name, path, kind);
  return ICON_COLOR_BY_KIND[visual.kind];
}
