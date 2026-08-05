import type { ReactNode } from "react";

/**
 * One sanctioned component's spec-sheet row. `subpath` is the exact
 * canonical direct import: either an `@proliferate/ui` package export or a
 * `#product/components/patterns/*` ProductClient owner. The parity test in
 * `library-registry.test.ts` checks the appropriate real inventory.
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
