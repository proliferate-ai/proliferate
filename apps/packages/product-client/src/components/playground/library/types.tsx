import type { ReactNode } from "react";

/**
 * One sanctioned component's spec-sheet row. `subpath` is the exact
 * package.json `exports` key from the owning package (`@proliferate/ui` or
 * `@proliferate/product-ui`) — the parity test in `library-registry.test.ts`
 * asserts this registry covers exactly the exports map, so `subpath` is the
 * join key between "what ships" and "what the sheet documents".
 */
export interface LibraryEntry {
  name: string;
  subpath: string;
  render: () => ReactNode;
}

export interface LibraryTier {
  id: string;
  title: string;
  entries: LibraryEntry[];
}
