import {
  looksLikeFileReferenceHref,
  splitPathLineSuffix,
} from "#product/lib/domain/files/path-detection";

export interface AssistantMarkdownEndResource {
  rawPath: string;
  path: string;
  displayName: string;
  typeLabel: "Document · MD";
}

const MARKDOWN_LINK_DESTINATION = /(!?)\[[^\]]*\]\(\s*(?:<([^>]+)>|((?:\\.|[^\s)])+))/g;

/**
 * Resolve the last unique Markdown document linked by final assistant prose.
 * This is render-time presentation data, matching inline file-mention
 * ownership: nothing is persisted back into transcript state.
 */
export function resolveAssistantMarkdownEndResource(
  markdown: string | null | undefined,
): AssistantMarkdownEndResource | null {
  if (!markdown) return null;

  const visibleMarkdown = stripMarkdownCode(markdown);
  const seen = new Set<string>();
  let resolved: AssistantMarkdownEndResource | null = null;

  for (const match of visibleMarkdown.matchAll(MARKDOWN_LINK_DESTINATION)) {
    if (match[1] === "!") continue;
    const escapedDestination = match[2] ?? match[3] ?? "";
    const rawPath = unescapeMarkdownDestination(escapedDestination.trim());
    if (!looksLikeFileReferenceHref(rawPath)) continue;

    const destinationPath = stripQueryAndFragment(rawPath);
    const { path: pathWithoutLine } = splitPathLineSuffix(destinationPath);
    const displayPath = safelyDecodePath(pathWithoutLine);
    if (!/\.mdx?$/i.test(displayPath)) continue;

    const key = displayPath.replace(/\\/g, "/");
    if (seen.has(key)) continue;
    seen.add(key);
    resolved = {
      rawPath: safelyDecodePath(rawPath),
      path: displayPath,
      displayName: basename(displayPath),
      typeLabel: "Document · MD",
    };
  }

  return resolved;
}

function stripMarkdownCode(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(?:```|$)/g, "")
    .replace(/`[^`\n]*`/g, "");
}

function unescapeMarkdownDestination(value: string): string {
  return value.replace(/\\([\\()<>])/g, "$1");
}

function stripQueryAndFragment(value: string): string {
  const suffixIndex = value.search(/[?#]/);
  return suffixIndex >= 0 ? value.slice(0, suffixIndex) : value;
}

function safelyDecodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
