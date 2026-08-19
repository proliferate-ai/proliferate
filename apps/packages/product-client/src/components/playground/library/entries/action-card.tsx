import { useState } from "react";
import { RowActionIconButton } from "#product/primitives/RowActionIconButton";
import { ActionCard } from "#product/primitives/patterns/ActionCard";
import { Sparkles } from "#product/primitives/icons/product";
import { X } from "#product/primitives/icons/core";
import type { LibraryEntry } from "../types";

function ActionCardDemo() {
  const [status, setStatus] = useState("Ready");
  return (
    <div className="w-72">
      <ActionCard
        leading={<Sparkles className="icon-paired" />}
        title="Build a new feature"
        description="Start from the current repository."
        trailing={<span className="text-ui-sm text-muted-foreground">{status}</span>}
        secondaryAction={(
          <RowActionIconButton
            label="Dismiss suggestion"
            onClick={() => setStatus("Dismissed")}
            className="rounded-full"
          >
            <X />
          </RowActionIconButton>
        )}
        actionLabel="Build a new feature"
        onAction={() => setStatus("Selected")}
      />
    </div>
  );
}

export const ACTION_CARD_ENTRY: LibraryEntry = {
  name: "ActionCard",
  subpath: "#product/primitives/patterns/ActionCard",
  render: ActionCardDemo,
};
