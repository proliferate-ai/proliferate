import type { CollapsedActionKind } from "@proliferate/product-domain/chats/transcript/transcript-collapsed-actions";
import {
  CommandWindow,
  FilePenActivity,
  ReadBook,
  SearchActivity,
} from "@proliferate/ui/icons";

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
