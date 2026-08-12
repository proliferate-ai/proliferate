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
 * In-card row anatomy: the wash group (`SettingsGroup`) owns the divider
 * between rows, so a row carries no border of its own. Title sits at
 * `text-ui`/400 and detail at `text-ui-sm`, the same pairing `SettingsRow`
 * uses, so crossing from the sidebar into this pane crosses no type step.
 */
export const ACCOUNT_ROW_CLASS = "flex items-center gap-3.5 px-3.5 py-[13px]";

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
    <div className={ACCOUNT_ROW_CLASS}>
      <span className="flex w-5 shrink-0 items-center justify-center text-foreground">
        <ProviderBrandIcon
          provider={provider.provider}
          label={provider.brandLabel ?? provider.label}
          className="icon-control shrink-0"
        />
      </span>
      <div className="min-w-0 flex-1 space-y-px">
        <div className="text-ui text-foreground">{provider.label}</div>
        <div className="text-ui-sm text-muted-foreground [text-wrap:pretty]">
          {description}
        </div>
      </div>
      <span className="shrink-0 text-ui-sm text-muted-foreground">{statusLabel}</span>
      {rowActions.map((action, idx) => (
        <AccountAction
          key={idx}
          action={action}
          variant={idx === 0 ? "secondary" : "ghost"}
          size="sm"
        />
      ))}
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
      <span className="flex w-5 shrink-0 items-center justify-center text-foreground">
        <ProviderBrandIcon provider="github" className="icon-control shrink-0" />
      </span>
      <div className="min-w-0 flex-1 space-y-px">
        <div className="text-ui text-foreground">{service.label}</div>
        <div className="text-ui-sm text-muted-foreground [text-wrap:pretty]">
          {service.description}
          {service.accountLabel ? ` · ${service.accountLabel}` : ""}
        </div>
      </div>
      <span className="shrink-0 text-ui-sm text-muted-foreground">{service.statusLabel}</span>
      {service.action ? <AccountAction action={service.action} variant="secondary" /> : null}
    </div>
  );
}
