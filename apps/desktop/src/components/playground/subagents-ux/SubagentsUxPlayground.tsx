import { useState } from "react";
import { SegmentedControl } from "@proliferate/ui/primitives/SegmentedControl";
import { FullFlowPrototype } from "./full-flow/FullFlowPrototype";
import { IdentityReceiptsPrototype } from "./identity-receipts/IdentityReceiptsPrototype";
import { NavigationClosePrototype } from "./navigation-close/NavigationClosePrototype";
import { PopoverPanePrototype } from "./popover-pane/PopoverPanePrototype";

type PrototypeView = "full-flow" | "identity" | "popover-pane" | "navigation-close";

const PROTOTYPE_VIEWS = [
  { id: "full-flow", label: "Full flow" },
  { id: "identity", label: "Identity + receipt" },
  { id: "popover-pane", label: "Popover + pane" },
  { id: "navigation-close", label: "Tabs + close" },
] as const satisfies readonly { id: PrototypeView; label: string }[];

/**
 * Dev-only interactive lab. "Full flow" is the coherent default walkthrough
 * of the whole delegated-work model; the other lanes stay as focused
 * comparison surfaces. These remain fixture surfaces until a direction is
 * selected and promoted into the production Subagents components.
 */
export function SubagentsUxPlayground() {
  const [view, setView] = useState<PrototypeView>("full-flow");

  return (
    <div
      className="flex h-screen min-h-0 w-full flex-col overflow-hidden bg-background text-foreground"
      data-subagents-ux-lab
    >
      <header className="flex shrink-0 flex-wrap items-center gap-4 border-b border-border px-5 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold">Subagents UX lab</h1>
          <p className="truncate text-ui-sm text-muted-foreground">
            Interactive Fable drafts · fixture data only · no production session mutations
          </p>
        </div>
        <SegmentedControl
          items={PROTOTYPE_VIEWS}
          value={view}
          onChange={setView}
          ariaLabel="Subagents prototype view"
        />
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "full-flow" ? <FullFlowPrototype /> : null}
        {view === "identity" ? (
          <div className="h-full overflow-y-auto p-6">
            <div className="mx-auto max-w-4xl">
              <IdentityReceiptsPrototype />
            </div>
          </div>
        ) : null}
        {view === "popover-pane" ? <PopoverPanePrototype /> : null}
        {view === "navigation-close" ? (
          <div className="h-full min-h-0 p-4">
            <NavigationClosePrototype />
          </div>
        ) : null}
      </div>
    </div>
  );
}
