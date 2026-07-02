import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@proliferate/ui/kit/Dialog";
import { ShortcutBadge } from "@proliferate/ui/layout/ShortcutBadge";
import { PopoverSearchField } from "@proliferate/ui/primitives/PopoverSearchField";
import {
  buildShortcutSections,
  type ShortcutSectionView,
} from "@/lib/domain/shortcuts/shortcut-sections";

function ShortcutSection({ section }: { section: ShortcutSectionView }) {
  return (
    <section aria-label={section.title}>
      <div className="px-2.5 pb-1 pt-3 text-ui-sm font-medium text-muted-foreground">
        {section.title}
      </div>
      {section.entries.map((entry) => (
        <div
          key={entry.id}
          className="flex h-8 items-center justify-between gap-4 rounded-lg px-2.5 hover:bg-accent"
        >
          <span className="min-w-0 truncate text-ui text-foreground">{entry.command}</span>
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
            {entry.labels.map((label) => (
              <ShortcutBadge
                key={label}
                label={label}
                className="min-h-5 rounded px-1.5 text-ui-sm"
              />
            ))}
          </span>
        </div>
      ))}
    </section>
  );
}

/**
 * Keyboard-shortcuts modal (UX spec §9), opened from the sidebar account
 * popover. Modal-native chrome — visible title, borderless inline search,
 * flat groups — over the same section data as the settings pane.
 */
export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const sections = useMemo(
    () => buildShortcutSections(normalizedQuery),
    [normalizedQuery],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setQuery("");
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-lg gap-0 p-0">
        <div className="px-4 pb-1.5 pt-3.5">
          <DialogTitle className="text-ui font-medium text-foreground">
            Keyboard shortcuts
          </DialogTitle>
        </div>
        <div className="px-1.5">
          <PopoverSearchField
            value={query}
            onChange={setQuery}
            placeholder="Search shortcuts"
            autoFocus
          />
        </div>
        <div className="border-t border-border-light" />
        <div className="max-h-[60vh] overflow-y-auto px-1.5 pb-1.5 pt-0.5">
          {sections.length > 0 ? (
            sections.map((section) => (
              <ShortcutSection key={section.title} section={section} />
            ))
          ) : (
            <div className="px-2.5 py-6 text-center text-ui-sm text-muted-foreground">
              No shortcuts found
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
