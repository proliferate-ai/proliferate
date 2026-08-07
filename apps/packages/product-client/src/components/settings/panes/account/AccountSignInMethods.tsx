import { Badge } from "#product/primitives/Badge";
import { Button } from "#product/primitives/Button";

import { ProviderBrandIcon } from "#product/components/auth/ProviderBrandIcon";
import type { AccountProviderView } from "#product/lib/domain/auth/account-profile-presentation";
import type {
  AccountActionView,
  AccountConnectedServiceView,
  AccountSettingsPaneProps,
} from "#product/components/settings/panes/account/AccountSettingsPane";

// ---------------------------------------------------------------------------
// Build effective provider rows with their matched actions
// ---------------------------------------------------------------------------

export interface ProviderRowData {
  provider: AccountProviderView;
  actions: AccountActionView[];
}

export function buildEffectiveProviders(
  providers: AccountProviderView[],
  actions: AccountSettingsPaneProps["actions"],
): ProviderRowData[] {
  const rows: ProviderRowData[] = providers.map((provider) => ({
    provider,
    actions: getActionsForProvider(provider, actions),
  }));

  // Synthesize apple row if connectApple action exists but no apple provider row
  const hasAppleRow = providers.some((p) => p.provider === "apple");
  if (!hasAppleRow && actions.connectApple) {
    rows.push({
      provider: {
        provider: "apple",
        label: "Apple",
        accountLabel: "Not connected",
        connected: false,
      },
      actions: [actions.connectApple],
    });
  }

  // Synthesize google row if connectGoogle action exists but no google provider row
  const hasGoogleRow = providers.some((p) => p.provider === "google");
  if (!hasGoogleRow && actions.connectGoogle) {
    rows.push({
      provider: {
        provider: "google",
        label: "Google",
        accountLabel: "Not connected",
        connected: false,
      },
      actions: [actions.connectGoogle],
    });
  }

  return rows;
}

function getActionsForProvider(
  provider: AccountProviderView,
  actions: AccountSettingsPaneProps["actions"],
): AccountActionView[] {
  const result: AccountActionView[] = [];

  if (provider.provider === "github") {
    if (actions.connectGitHub) result.push(actions.connectGitHub);
    if (actions.reconnectGitHub) result.push(actions.reconnectGitHub);
  }

  if (provider.provider === "google" && actions.connectGoogle && !provider.connected) {
    result.push(actions.connectGoogle);
  }

  if (provider.provider === "apple" && actions.connectApple && !provider.connected) {
    result.push(actions.connectApple);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Row components
// ---------------------------------------------------------------------------

/**
 * Account rows read at the sidebar's scale, not one step above it.
 *
 * These rows used to sit on `text-body`, which put a signed-in account's own
 * details a size larger than every nav row and settings row surrounding them —
 * the pane looked zoomed relative to the app it lives in. `text-ui` for titles
 * and `text-ui-sm` for detail is the same pairing `SettingsRow` uses, so a
 * reader crossing from the sidebar into this pane crosses no type step at all.
 *
 * The hairline is a `border-t` with `first:border-t-0` rather than a trailing
 * `border-b`, so the panel's own border never doubles up with a row's.
 */
export const ACCOUNT_ROW_CLASS =
  "flex min-h-[3.5rem] flex-col gap-2 border-t border-border-light py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6";

export function AccountAction({
  action,
  variant = "secondary",
  size = "sm",
}: {
  action: AccountActionView;
  variant?: "secondary" | "ghost";
  size?: "sm" | "md";
}) {
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={action.disabled}
      loading={action.loading}
      onClick={action.onClick}
      className={action.destructive && variant === "ghost" ? "text-destructive hover:text-destructive" : ""}
    >
      {!action.loading && action.icon ? action.icon : null}
      {action.label}
    </Button>
  );
}

export function SignInMethodRow({
  provider,
  actions: rowActions,
  githubLabel,
}: {
  provider: AccountProviderView;
  actions: AccountActionView[];
  githubLabel: string;
}) {
  const statusLabel = provider.connected
    ? provider.status === "needs_reauth"
      ? "Reconnect"
      : provider.status === "expired"
        ? "Expired"
        : "Connected"
    : "Not connected";

  // Use githubLabel as detail fallback for GitHub row when no accountLabel
  const detail = provider.provider === "github" && !provider.accountLabel
    ? githubLabel
    : provider.accountLabel;

  return (
    <div className={ACCOUNT_ROW_CLASS}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ProviderBrandIcon
          provider={provider.provider}
          label={provider.brandLabel ?? provider.label}
          className="icon-control shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 text-ui font-medium text-foreground">
            <span>{provider.label}</span>
            {provider.primary && provider.connected ? (
              <Badge tone="neutral" className="shrink-0 whitespace-nowrap">Primary</Badge>
            ) : null}
          </div>
          <div className="truncate text-ui-sm text-muted-foreground">
            {detail || (provider.connected ? "Connected" : "Not connected")}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge tone="neutral" className="shrink-0 whitespace-nowrap">
          {statusLabel}
        </Badge>
        {rowActions.map((action, idx) => (
          <AccountAction
            key={idx}
            action={action}
            variant={idx === 0 ? "secondary" : "ghost"}
            size="sm"
          />
        ))}
      </div>
    </div>
  );
}

export function ConnectedServiceRow({
  service,
}: {
  service: AccountConnectedServiceView;
}) {
  return (
    <div className={ACCOUNT_ROW_CLASS}>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2 text-ui font-medium text-foreground">
          <span>{service.label}</span>
          <Badge tone="neutral" className="shrink-0 whitespace-nowrap">
            {service.statusLabel}
          </Badge>
        </div>
        <div className="text-ui-sm text-muted-foreground">{service.description}</div>
        {service.accountLabel ? (
          <div className="truncate text-ui-sm text-muted-foreground">{service.accountLabel}</div>
        ) : null}
      </div>
      {service.action ? (
        <div className="shrink-0">
          <AccountAction action={service.action} variant="secondary" />
        </div>
      ) : null}
    </div>
  );
}
