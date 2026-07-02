import { useMemo, useState } from "react";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { Search } from "@proliferate/ui/icons";
import { Input } from "@proliferate/ui/primitives/Input";
import {
  buildShortcutSections,
  type ShortcutEntryView,
  type ShortcutSectionView,
} from "@/lib/domain/shortcuts/shortcut-sections";

function ShortcutBadge({ label }: { label: string }) {
  return (
    <kbd className="inline-flex min-h-7 shrink-0 items-center justify-center rounded-md border-0 bg-current/10 px-2 py-1 font-sans text-xs leading-none text-current shadow-none">
      {label}
    </kbd>
  );
}

function ShortcutRow({ command, labels }: ShortcutEntryView) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5 hover:bg-foreground/5">
      <span className="min-w-0 truncate text-sm text-foreground">{command}</span>
      <div className="ml-auto flex min-h-7 flex-wrap items-center justify-end gap-1.5 text-muted-foreground">
        {labels.map((label) => (
          <ShortcutBadge key={label} label={label} />
        ))}
      </div>
    </li>
  );
}

function ShortcutSection({ section }: { section: ShortcutSectionView }) {
  const sectionId = `keyboard-shortcuts-${section.title.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <section
      aria-labelledby={sectionId}
      className="overflow-hidden rounded-lg border border-border-light bg-surface-elevated shadow-subtle"
    >
      <header className="border-b border-border-light bg-foreground/5 px-4 py-2.5">
        <h3
          id={sectionId}
          className="text-sm font-medium text-foreground"
        >
          {section.title}
        </h3>
      </header>
      <ul className="divide-y divide-border-light">
        {section.entries.map((entry) => (
          <ShortcutRow key={entry.id} {...entry} />
        ))}
      </ul>
    </section>
  );
}

export function KeyboardShortcutsPane() {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const sections = useMemo(
    () => buildShortcutSections(normalizedQuery),
    [normalizedQuery],
  );

  const hasShortcuts = sections.length > 0;

  return (
    <section className="space-y-5">
      <SettingsPageHeader
        title="Keyboard shortcuts"
      />

      <div className="space-y-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search shortcuts"
            aria-label="Search keyboard shortcuts"
            className="h-9 border-border-light bg-transparent pl-8"
          />
        </div>

        {hasShortcuts ? (
          <div className="space-y-3">
            {sections.map((section) => (
              <ShortcutSection key={section.title} section={section} />
            ))}
          </div>
        ) : (
          <SettingsEmptyState size="compact" title="No shortcuts found" />
        )}
      </div>
    </section>
  );
}
