import {
  SETTINGS_SCOPE_LABELS,
  SETTINGS_SCOPE_ORDER,
  type SettingsScope,
} from "@/lib/domain/settings/navigation-presentation";

/**
 * Horizontal scope switcher (User · Org · Repo · Agents) — underline tabs, per
 * CONTRACT §4 / the design-system `ScopeTabs`. Flat: no pills, active tab is the
 * foreground-colored label with a 2px foreground underline.
 */
export function SettingsScopeTabs({
  value,
  onChange,
}: {
  value: SettingsScope;
  onChange: (scope: SettingsScope) => void;
}) {
  return (
    <div className="flex h-full items-stretch gap-6" role="tablist" aria-label="Settings scope">
      {SETTINGS_SCOPE_ORDER.map((scope) => {
        const active = scope === value;
        return (
          <button
            key={scope}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(scope)}
            className={`relative -mb-px inline-flex items-center border-b-2 text-[13px] leading-none transition-colors ${
              active
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {SETTINGS_SCOPE_LABELS[scope]}
          </button>
        );
      })}
    </div>
  );
}
