import { Link } from "react-router-dom";
import { Button } from "@proliferate/ui/primitives/Button";
import { Moon, Sun } from "@proliferate/ui/icons";
// Explicit /index: the `#product/*` imports map rewrites to `./dist/*.js`,
// so a bare directory specifier would resolve to `dist/.../library.js`
// (nonexistent) instead of the barrel's `dist/.../library/index.js`.
import { LIBRARY_TIERS } from "#product/components/playground/library/index";
import { useColorMode } from "#product/hooks/theme/workflows/use-theme-preferences";

/**
 * Component-library spec sheet: every sanctioned `@proliferate/ui` /
 * `@proliferate/product-ui` component, tier by tier, rendered under the real
 * theme. The registry (`components/playground/library/*`) is the single
 * source of what's in this sheet; `library-registry.test.ts` fails CI if a
 * sanctioned export drifts out of sync with it.
 */
export function PlaygroundLibrary() {
  // Reuses the app's real appearance-preference mechanism (config/theme.ts +
  // the user-preferences store), the same toggle AppearancePane exposes — not
  // a local dev-only attribute hack, since this route is mounted under the
  // same ProductLifecycleRoot that applies the preference on every route.
  const [mode, setMode] = useColorMode();
  const isLight = mode === "light";

  return (
    <div className="flex h-screen flex-col overflow-y-auto bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="text-heading font-semibold">Component library</div>
        <Link
          to="/playground"
          className="rounded-md border border-border px-2 py-1 text-ui-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Playground
        </Link>
        <div className="flex-1" />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setMode(isLight ? "dark" : "light")}
        >
          {isLight ? <Sun className="icon-paired" /> : <Moon className="icon-paired" />}
          {isLight ? "Light" : "Dark"}
        </Button>
      </header>
      <div className="px-4 py-6 sm:px-6">
        {LIBRARY_TIERS.map((tier) => (
          <section key={tier.id} className="mb-10">
            <h2 className="mb-3 text-heading font-semibold text-foreground">{tier.title}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {tier.entries.map((entry) => (
                <div
                  key={entry.subpath}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-surface-elevated p-3"
                >
                  <div className="flex min-h-16 flex-1 items-center justify-center rounded-md border border-border-light bg-surface-elevated-secondary p-3">
                    {entry.render()}
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-ui-sm font-medium text-foreground">{entry.name}</div>
                    <div className="truncate text-ui-sm text-muted-foreground">{entry.subpath}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
