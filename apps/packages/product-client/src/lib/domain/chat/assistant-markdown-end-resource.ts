import {
  repairTranscriptFileLinks,
  scanTranscriptMarkdownLinks,
  unescapeMarkdownDestination,
} from "#product/lib/domain/chat/transcript/file-link-markdown";
import {
  looksLikeFileReferenceHref,
  splitPathLineSuffix,
} from "#product/lib/domain/files/path-detection";
import { decodeFileReferenceSpaces } from "#product/lib/domain/files/path-references";

export interface AssistantMarkdownEndResource {
  rawPath: string;
  path: string;
  displayName: string;
  typeLabel: "Document · MD";
}

/**
 * Resolve the last unique Markdown document linked by final assistant prose.
 * This is render-time presentation data, matching inline file-mention
 * ownership: nothing is persisted back into transcript state.
 *
 * It reads the same settled repaired copy and the same complete-balanced-link
 * scan the inline mentions render from, so the card and the prose can never
 * disagree about which document was named. It never runs streaming
 * stabilization, so a synthetic closing delimiter can never produce a card.
 *
 * Decoding is the shared raw-reference `%20` rule and nothing more: encoded
 * separators and traversal stay literal, and `?`/`#` are literal path
 * characters rather than URL delimiters, so the card cannot be steered to a
 * different target than the link text names.
 */
export function resolveAssistantMarkdownEndResource(
  markdown: string | null | undefined,
): AssistantMarkdownEndResource | null {
  if (!markdown) return null;

  const seen = new Set<string>();
  let resolved: AssistantMarkdownEndResource | null = null;

  for (const link of scanTranscriptMarkdownLinks(repairTranscriptFileLinks(markdown))) {
    if (link.isImage) continue;
    const rawPath = decodeFileReferenceSpaces(
      unescapeMarkdownDestination(link.destination).trim(),
    );
    if (!looksLikeFileReferenceHref(rawPath)) continue;

    const { path } = splitPathLineSuffix(rawPath);
    // Case-insensitive, and on the exact decoded path — never on a stripped or
    // separately decoded variant.
    if (!/\.mdx?$/i.test(path)) continue;

    const key = path.replace(/\\/g, "/");
    if (seen.has(key)) continue;
    seen.add(key);
    resolved = {
      rawPath,
      path,
      displayName: basename(path),
      typeLabel: "Document · MD",
    };
  }

  return resolved;
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
