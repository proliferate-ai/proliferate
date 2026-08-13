import { Card } from "#product/primitives/patterns/Card";
import type { LibraryEntry } from "../types";

/**
 * Self-contained demo: no providers, no stores, fixture content only.
 *
 * The tint card is given a scrolling body so the sticky header's double-layer
 * ground is actually visible doing its job — a static screenshot of a sticky
 * header proves nothing.
 */
function CardDemo() {
  return (
    <div className="flex w-72 flex-col gap-2">
      <Card
        header={<div className="px-3 py-1.5 text-ui text-muted-foreground">src/app/page.tsx</div>}
        footer={<div className="px-3 py-1.5 text-ui-sm text-muted-foreground">3 changes</div>}
        stickyHeader
        className="max-h-32 overflow-y-auto"
      >
        <div className="flex flex-col gap-1 px-3 py-2">
          {Array.from({ length: 10 }, (_, index) => (
            <div key={index} className="text-ui-sm text-foreground">Body line {index + 1}</div>
          ))}
        </div>
      </Card>
      <Card surface="opaque" as="section">
        <div className="px-4 py-3">
          <div className="text-ui font-medium text-foreground">Opaque panel</div>
          <p className="text-ui-sm text-muted-foreground">Bordered card for content that must occlude.</p>
        </div>
      </Card>
    </div>
  );
}

/**
 * Registry row for `Card`. Kept in its own file so parallel component work does
 * not collide in `patterns.tsx`; the tier list imports and splices it.
 */
export const CARD_ENTRY: LibraryEntry = {
  name: "Card",
  subpath: "#product/primitives/patterns/Card",
  render: CardDemo,
};
