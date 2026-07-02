import { Button } from "@proliferate/ui/primitives/Button";

export interface SettingsScopeTabItem<Id extends string = string> {
  id: Id;
  label: string;
}

/**
 * Horizontal scope switcher (User · Org · Repo · Agents) — underline tabs, per
 * CONTRACT §4 / the design-system `ScopeTabs`. Flat: no pills, active tab is the
 * foreground-colored label with a 2px foreground underline.
 */
export function SettingsScopeTabs<Id extends string>({
  items,
  value,
  onChange,
}: {
  items: readonly SettingsScopeTabItem<Id>[];
  value: Id;
  onChange: (id: Id) => void;
}) {
  return (
    <div className="flex h-full items-stretch gap-6" role="tablist" aria-label="Settings scope">
      {items.map((item) => {
        const active = item.id === value;
        return (
          <Button
            key={item.id}
            type="button"
            variant="unstyled"
            size="unstyled"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={`relative -mb-px inline-flex items-center border-b-2 text-[13px] leading-none transition-colors ${
              active
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.label}
          </Button>
        );
      })}
    </div>
  );
}
