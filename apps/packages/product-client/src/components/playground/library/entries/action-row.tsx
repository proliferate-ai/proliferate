import { Button } from "#product/primitives/Button";
import { RowActionIconButton } from "#product/primitives/RowActionIconButton";
import { ActionRow } from "#product/primitives/patterns/ActionRow";
import { X } from "#product/primitives/icons/core";
import type { LibraryEntry } from "../types";

const noop = () => {};

function ActionRowDemo() {
  return (
    <div className="flex w-72 flex-col gap-0.5">
      <ActionRow
        title="Ship the changelog draft"
        secondary="Interrupted · runtime restarted"
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={noop}>
              Resume
            </Button>
            <RowActionIconButton label="Dismiss" onClick={noop}>
              <X />
            </RowActionIconButton>
          </>
        }
      />
      <ActionRow
        title="Unsent message from the previous session"
        secondary="The prompt could not be delivered"
        secondaryTone="destructive"
        actions={
          <Button size="sm" variant="secondary" onClick={noop}>
            Retry
          </Button>
        }
      />
    </div>
  );
}

/**
 * Registry row for `ActionRow`. Kept in its own module so the shared
 * `patterns.tsx` tier list only gains an import and one array entry.
 */
export const ACTION_ROW_ENTRY: LibraryEntry = {
  name: "ActionRow",
  subpath: "#product/primitives/patterns/ActionRow",
  render: ActionRowDemo,
};
