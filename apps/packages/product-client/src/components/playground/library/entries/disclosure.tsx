import { useState } from "react";

import { Badge } from "#product/primitives/Badge";
import { Disclosure } from "#product/primitives/patterns/Disclosure";
import { noop } from "#product/components/playground/PlaygroundComposerActions";
import type { LibraryEntry } from "../types";

/**
 * Self-contained `Disclosure` spec-sheet demo: both chevron sides, a trailing
 * slot, and real expand/collapse over local state — no providers, no stores.
 */
function DisclosureDemo() {
  const [leadingOpen, setLeadingOpen] = useState(true);
  const [trailingOpen, setTrailingOpen] = useState(false);

  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <Disclosure
        open={leadingOpen}
        onOpenChange={setLeadingOpen}
        title="Grouped rows"
        trailing={<Badge tone="neutral">3</Badge>}
      >
        <div className="px-2 pb-2 text-ui-sm text-muted-foreground">
          Leading chevron: the grouped-list spelling.
        </div>
      </Disclosure>

      <Disclosure
        open={trailingOpen}
        onOpenChange={setTrailingOpen}
        chevronSide="trailing"
        title="Section header"
      >
        <div className="px-2 pb-2 text-ui-sm text-muted-foreground">
          Trailing chevron: the card and section-header spelling.
        </div>
      </Disclosure>

      <Disclosure open={false} onOpenChange={noop} disabled title="Disabled">
        <div className="px-2 pb-2 text-ui-sm text-muted-foreground">
          Never reachable while disabled.
        </div>
      </Disclosure>
    </div>
  );
}

export const DISCLOSURE_LIBRARY_ENTRY: LibraryEntry = {
  name: "Disclosure",
  subpath: "#product/primitives/patterns/Disclosure",
  render: DisclosureDemo,
};
