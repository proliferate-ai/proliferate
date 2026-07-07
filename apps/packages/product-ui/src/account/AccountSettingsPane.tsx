import { useState, type ReactNode } from "react";

import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";

import { SettingsSection } from "../settings/SettingsSection";
import {
  AccountPasswordCredentialRow,
  type AccountPasswordCredentialView,
} from "./AccountPasswordCredentialCard";
import { ProviderBrandIcon } from "../auth/ProviderBrandIcon";

export type {
  AccountPasswordCredentialSubmit,
  AccountPasswordCredentialView,
} from "./AccountPasswordCredentialCard";

export type AccountProviderKind = "github" | "google" | "apple" | "sso";

export interface AccountProviderView {
  provider: AccountProviderKind;
  label: string;
  brandLabel?: string | null;
  accountLabel?: string | null;
  connected: boolean;
  status?: "ready" | "needs_reauth" | "expired";
  primary?: boolean;
}

export interface AccountActionView {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  icon?: ReactNode;
  onClick: () => void;
}

export interface AccountConnectedServiceView {
  id: string;
  label: string;
  description: ReactNode;
  accountLabel?: string | null;
  statusLabel: string;
  tone?: "neutral" | "success" | "warning" | "destructive";
  action?: AccountActionView;
}

export interface AccountSettingsPaneProps {
  displayName: string;
  email: string;
  avatarUrl?: string | null;
  profileSummary: string;
  githubLabel: string;
  providers: AccountProviderView[];
  actions: {
    signIn?: AccountActionView;
    reconnectGitHub?: AccountActionView;
    connectGitHub?: AccountActionView;
    connectGoogle?: AccountActionView;
    connectApple?: AccountActionView;
    manageGitHubAccess?: AccountActionView;
    signOut?: AccountActionView;
  };
  accessTitle?: string;
  accessDescription?: ReactNode;
  providersTitle?: string;
  providersDescription?: ReactNode;
  connectedServicesTitle?: string;
  connectedServicesDescription?: ReactNode;
  connectedServices?: AccountConnectedServiceView[];
  passwordCredential?: AccountPasswordCredentialView;
  error?: ReactNode;
}

export function AccountSettingsPane({
  displayName,
  email,
  avatarUrl,
  profileSummary,
  githubLabel,
  providers,
  actions,
  accessDescription,
  providersTitle = "Sign-in methods",
  providersDescription = "How you sign in to this account across desktop, web, and mobile.",
  connectedServicesTitle = "Connected services",
  connectedServicesDescription = "Authorize services Proliferate uses inside managed cloud sandboxes.",
  connectedServices = [],
  passwordCredential,
  error,
}: AccountSettingsPaneProps) {
  // Resolve the sign-in methods section description: accessDescription overrides
  // providersDescription when present (desktop passes contextual state copy here).
  const signInMethodsDescription = accessDescription ?? providersDescription;

  // Build the effective provider rows, synthesizing apple/google if only an action exists
  const effectiveProviders = buildEffectiveProviders(providers, actions);

  // Determine sign-in section action (signIn for signed-out state)
  const sectionAction = actions.signIn ? (
    <AccountAction action={actions.signIn} variant="secondary" />
  ) : null;

  return (
    <div className="space-y-6">
      {/* 1. Profile header */}
      <SettingsSection>
        <AccountProfileHeader
          avatarUrl={avatarUrl ?? null}
          displayName={displayName}
          email={email}
          profileSummary={profileSummary}
        />
      </SettingsSection>

      {/* 2. Sign-in methods */}
      <SettingsSection
        title={providersTitle}
        description={signInMethodsDescription}
        action={sectionAction}
      >
        <div className="overflow-clip rounded-lg bg-foreground/5">
          {effectiveProviders.map((row) => (
            <SignInMethodRow
              key={`${row.provider.provider}-${row.provider.accountLabel ?? row.provider.label}`}
              provider={row.provider}
              actions={row.actions}
              githubLabel={githubLabel}
            />
          ))}
          {passwordCredential ? (
            <AccountPasswordCredentialRow credential={passwordCredential} />
          ) : null}
        </div>
      </SettingsSection>

      {/* 3. Connected services */}
      {connectedServices.length > 0 ? (
        <SettingsSection title={connectedServicesTitle} description={connectedServicesDescription}>
          <div className="overflow-clip rounded-lg bg-foreground/5">
            {connectedServices.map((service) => (
              <ConnectedServiceRow key={service.id} service={service} />
            ))}
          </div>
        </SettingsSection>
      ) : null}

      {/* 4. Footer */}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {actions.signOut ? (
        <div className="flex">
          <AccountAction action={actions.signOut} variant="secondary" />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal: build effective provider rows with their matched actions
// ---------------------------------------------------------------------------

interface ProviderRowData {
  provider: AccountProviderView;
  actions: AccountActionView[];
}

function buildEffectiveProviders(
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
// Internal components
// ---------------------------------------------------------------------------

function AccountAction({
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

function SignInMethodRow({
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
    <div className="flex min-h-[3.5rem] flex-col gap-2 border-b border-border-light px-3.5 py-3.5 text-sm last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <ProviderBrandIcon
          provider={provider.provider}
          label={provider.brandLabel ?? provider.label}
          className="size-5 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <span>{provider.label}</span>
            {provider.primary && provider.connected ? <Badge tone="neutral">Primary</Badge> : null}
          </div>
          <div className="truncate text-muted-foreground">
            {detail || (provider.connected ? "Connected" : "Not connected")}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge tone="neutral" className="shrink-0">
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

function ConnectedServiceRow({
  service,
}: {
  service: AccountConnectedServiceView;
}) {
  return (
    <div className="flex min-h-[3.5rem] flex-col gap-3 border-b border-border-light px-3.5 py-3.5 text-sm last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2 font-medium text-foreground">
          <span>{service.label}</span>
          <Badge tone="neutral" className="shrink-0">
            {service.statusLabel}
          </Badge>
        </div>
        <div className="text-muted-foreground">{service.description}</div>
        {service.accountLabel ? (
          <div className="truncate text-muted-foreground">{service.accountLabel}</div>
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

function AccountProfileHeader({
  avatarUrl,
  displayName,
  email,
  profileSummary,
}: {
  avatarUrl: string | null;
  displayName: string;
  email: string;
  profileSummary: string;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <AccountAvatar
        key={avatarUrl ?? "account-avatar"}
        avatarUrl={avatarUrl}
        displayName={displayName}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="truncate text-lg font-medium text-foreground">{displayName}</div>
        <div className="truncate text-sm text-muted-foreground">{email}</div>
        <p className="text-sm leading-6 text-muted-foreground">{profileSummary}</p>
      </div>
    </div>
  );
}

function AccountAvatar({
  avatarUrl,
  displayName,
}: {
  avatarUrl: string | null;
  displayName: string;
}) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatar = Boolean(avatarUrl) && !avatarFailed;

  return (
    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-light bg-foreground/5 text-lg font-medium text-muted-foreground">
      {showAvatar ? (
        <img
          src={avatarUrl ?? ""}
          alt={`${displayName} profile`}
          className="size-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setAvatarFailed(true)}
        />
      ) : (
        <span>{initialsForName(displayName)}</span>
      )}
    </div>
  );
}

function initialsForName(name: string): string {
  const parts = name
    .split(/\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }
  return (parts[0]?.slice(0, 2) || "P").toUpperCase();
}
