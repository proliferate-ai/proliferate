import type { ContextDocMentionCandidate } from "#product/lib/domain/chat/composer/context-doc-mention";
import type { FileMentionResult } from "#product/lib/domain/chat/composer/file-mention-search";

/**
 * One row of the composer's `@` mention menu, kind-tagged so the menu can
 * group the sources and the editor can insert the matching chip node.
 */
export type ChatMentionMenuItem =
  | { kind: "file"; file: FileMentionResult }
  | { kind: "contextDoc"; doc: ContextDocMentionCandidate };

/**
 * Merges the two candidate sources into one navigable list: context docs
 * first, then files.
 *
 * Docs lead because their set is small, bounded, and — unlike file search,
 * which needs a query before it returns anything — already answerable on a
 * bare `@`, so the menu has useful rows the moment it opens. With the doc
 * source disabled or empty the list is exactly the file list.
 */
export function mergeChatMentionMenuItems(
  contextDocs: readonly ContextDocMentionCandidate[],
  files: readonly FileMentionResult[],
): ChatMentionMenuItem[] {
  return [
    ...contextDocs.map((doc): ChatMentionMenuItem => ({ kind: "contextDoc", doc })),
    ...files.map((file): ChatMentionMenuItem => ({ kind: "file", file })),
  ];
}
