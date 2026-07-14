import type { ReactElement } from "react";

// QUALIFICATION-ONLY. A trivial lazily-loaded chunk imported via a dynamic
// `import()` from the authenticated canary, proving on-demand code-splitting
// inside the authenticated subtree.
export default function CanaryLazyChunk(): ReactElement {
  return <span data-testid="canary-lazy-chunk">canary-lazy-chunk</span>;
}
