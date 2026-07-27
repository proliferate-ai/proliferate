import { ShortcutBadge } from "@proliferate/ui";

export const Shortcuts = () => (
  <div className="flex flex-wrap items-center gap-2">
    <ShortcutBadge label="⌘K" />
    <ShortcutBadge label="⌘⇧P" />
    <ShortcutBadge label="Esc" />
    <ShortcutBadge label="↵" />
  </div>
);

export const InRow = () => (
  <div className="flex w-64 items-center justify-between rounded-lg border border-border px-3 py-2">
    <span className="text-ui-sm text-foreground">Open command palette</span>
    <ShortcutBadge label="⌘K" />
  </div>
);
