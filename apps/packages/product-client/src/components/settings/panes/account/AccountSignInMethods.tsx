import { Button } from "#product/primitives/Button";
import { RosterRow } from "#product/primitives/patterns/RosterRow";

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
 * Fixed-width leading column so the provider mark's box stays the same size
 * across rows even though brand marks differ in natural proportions — title
 * text keeps one left edge across the whole roster.
 */
const ROW_LEADING_COLUMN_CLASS = "flex w-5 items-center justify-center text-foreground";

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

  const isPrimary = provider.primary && provider.connected;
  const description = isPrimary
    ? detail
      ? `Primary sign-in method · ${detail}`
      : "Primary sign-in method"
    : detail || (provider.connected ? "Connected" : "Not connected");

  return (
    <RosterRow
      density="comfortable"
      leading={(
        <span className={ROW_LEADING_COLUMN_CLASS}>
          <ProviderBrandIcon
            provider={provider.provider}
            className="icon-control shrink-0"
          />
        </span>
      )}
      title={provider.label}
      secondary={description}
      trailing={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="min-w-0 truncate text-ui-sm text-muted-foreground">{statusLabel}</span>
          {rowActions.map((action, idx) => (
            <AccountAction
              key={idx}
              action={action}
              variant={idx === 0 ? "secondary" : "ghost"}
              size="sm"
            />
          ))}
        </div>
      )}
    />
  );
}

export function ConnectedServiceRow({
  service,
}: {
  service: AccountConnectedServiceView;
}) {
  return (
    <RosterRow
      density="comfortable"
      leading={(
        <span className={ROW_LEADING_COLUMN_CLASS}>
          <ProviderBrandIcon provider="github" className="icon-control shrink-0" />
        </span>
      )}
      title={service.label}
      secondary={(
        <>
          {service.description}
          {service.accountLabel ? ` · ${service.accountLabel}` : ""}
        </>
      )}
      trailing={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="min-w-0 truncate text-ui-sm text-muted-foreground">{service.statusLabel}</span>
          {service.action ? <AccountAction action={service.action} variant="secondary" /> : null}
        </div>
      )}
    />
  );
}
