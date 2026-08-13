import { ChevronRight } from "#product/primitives/icons/core";
import { Button } from "#product/primitives/Button";
import { IconTile } from "#product/primitives/IconTile";
import { Input } from "#product/primitives/Input";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import {
  getProviderSecretEnvVar,
  type ProviderRegistryEntry,
} from "#product/config/harness-env-vars";
import { PROVIDER_LOGO_URLS } from "#product/config/provider-logos.generated";

/** 24px icon tile: vendored mark, else a mono letter fallback. */
function ProviderLogo({ provider }: { provider: ProviderRegistryEntry }) {
  const src = PROVIDER_LOGO_URLS[provider.id];
  return (
    <IconTile
      tone="outlined"
      size="sm"
      aria-hidden
      className="font-mono text-ui-sm"
    >
      {src === undefined
        ? provider.displayName.slice(0, 1).toUpperCase()
        : (
          // The vendored marks paint with `currentColor`, which resolves to
          // BLACK inside an <img> — invisible on the dark surface. Force the
          // mono treatment: flatten to black, invert to white, ease to ~78%.
          <img
            src={src}
            alt=""
            className="size-4 brightness-0 invert-[0.78]"
          />
        )}
    </IconTile>
  );
}

/**
 * One accordion row of the provider management modal (ProviderPickerModal):
 * collapsed header (logo, name, configured dot), expanding to the wired-state
 * line + Remove for configured providers and the paste/replace key form.
 * Split out of the modal purely for file-size structure; the modal owns all
 * state and passes it down.
 */
export function ProviderRow({
  provider,
  expanded,
  configured,
  redactedHint,
  secret,
  submitting,
  error,
  onToggle,
  onSecretChange,
  onConfirm,
  onRemove,
}: {
  provider: ProviderRegistryEntry;
  expanded: boolean;
  configured: boolean;
  redactedHint: string | null;
  secret: string;
  submitting: boolean;
  error: string | null;
  onToggle: () => void;
  onSecretChange: (value: string) => void;
  onConfirm: () => void;
  onRemove: () => void;
}) {
  const envVarName = getProviderSecretEnvVar(provider);
  return (
    // Disclosure is deferred here (frozen spec §4.3 pattern): the modal keeps
    // only ONE row's form mounted at a time and several tests assert true
    // unmount on collapse (screen.queryByLabelText(...).toBeNull()) —
    // Disclosure's AnimatedCollapsibleContent keeps children permanently
    // mounted (aria-hidden + inert, never removed), which Testing Library's
    // non-role queries do not filter out. Swapping would break those
    // assertions without a matching product change, so the hand-rolled
    // expand/collapse (real unmount) stays; only the icon tile adopts the
    // shared primitive below.
    <li className={expanded ? "bg-selected" : undefined}>
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full cursor-pointer select-none items-center gap-2.5 rounded-none px-3 py-2.5 text-ui font-normal text-foreground outline-none transition-colors hover:bg-hover focus:bg-hover"
      >
        <ProviderLogo provider={provider} />
        <span className="font-medium">{provider.displayName}</span>
        {configured ? (
          <span className="flex items-center gap-1.5 text-ui-sm text-success">
            <span aria-hidden className="icon-status rounded-full bg-current" />
            {HARNESS_PANE_COPY.providersModalConfigured}
          </span>
        ) : null}
        <span className="ml-auto flex items-center text-muted-foreground">
          <ChevronRight
            className={`icon-paired transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </span>
      </Button>
      {expanded ? (
        <div className="space-y-2 px-3 pb-3">
          {configured ? (
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate font-mono text-ui-sm text-muted-foreground/65">
                {envVarName}
                {redactedHint ? ` · ${redactedHint}` : ""}
              </span>
              <Button
                type="button"
                variant="unstyled"
                size="unstyled"
                className="shrink-0 text-ui-sm font-medium text-destructive hover:underline"
                disabled={submitting}
                onClick={onRemove}
              >
                {HARNESS_PANE_COPY.providersModalRemove}
              </Button>
            </div>
          ) : null}
          {/* Plain guidance until a per-provider console-URL registry exists —
              no arrow/link styling on a non-interactive element. */}
          <p className="text-ui-sm text-muted-foreground">
            {HARNESS_PANE_COPY.getApiKey}
          </p>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            <Input
              aria-label={`${provider.displayName} API key`}
              placeholder={`${configured ? "Replace" : "Paste"} your ${provider.displayName} API key`}
              type="password"
              value={secret}
              autoComplete="off"
              spellCheck={false}
              data-telemetry-mask
              className="h-8"
              onChange={(event) => onSecretChange(event.target.value)}
              autoFocus
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={submitting || secret.trim().length === 0}
            >
              Save
            </Button>
          </form>
          {error === null ? null : (
            <p role="alert" className="text-ui-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      ) : null}
    </li>
  );
}
