import type { ReactNode } from "react";

/**
 * One sanctioned component's spec-sheet row. `subpath` is the exact canonical
 * direct import under `#product/primitives/*` or
 * `#product/components/patterns/*`. The parity test in
 * `library-registry.test.ts` checks the corresponding physical inventory.
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
