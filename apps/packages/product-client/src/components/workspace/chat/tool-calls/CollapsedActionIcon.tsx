import type { CollapsedActionKind } from "#product/domain/chats/transcript/transcript-collapsed-actions";
import {
  CommandWindow,
  FilePenActivity,
  ReadBook,
} from "#product/primitives/icons/workspace";
import { SearchActivity } from "#product/primitives/icons/core";

/**
 * One semantic glyph map for both collapsed activity headers and their
 * expanded ledger rows. Keeping it shared prevents the summary and details
 * from drifting to different icon families.
 */
export function CollapsedActionIcon({ kind }: { kind: CollapsedActionKind }) {
  switch (kind) {
    case "read":
    case "fetch":
      return <ReadBook />;
    case "edit":
      return <FilePenActivity />;
    case "listing":
    case "search":
      return <SearchActivity />;
    case "command":
    case "action":
    default:
      return <CommandWindow />;
  }
}
