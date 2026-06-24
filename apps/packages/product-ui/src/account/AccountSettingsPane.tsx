import { useState, type ReactNode } from "react";

import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";

import { SettingsCard } from "../settings/SettingsCard";
import { SettingsCardRow } from "../settings/SettingsCardRow";
import {
  AccountPasswordCredentialCard,
  type AccountPasswordCredentialView,
} from "./AccountPasswordCredentialCard";

export type {
  AccountPasswordCredentialSubmit,
  AccountPasswordCredentialView,
} from "./AccountPasswordCredentialCard";

export type AccountProviderKind = "github" | "google" | "apple";

export interface AccountProviderView {
  provider: AccountProviderKind;
  label: string;
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
  accessTitle = "Account access",
  accessDescription = "Sign in and link providers so web, mobile, and desktop resolve to the same Proliferate account.",
  providersTitle = "Connected providers",
  providersDescription = "GitHub is required for repository access. Add Google and Apple identities to sign in across devices without creating a separate account.",
  passwordCredential,
  error,
}: AccountSettingsPaneProps) {
  return (
    <div className="space-y-6">
      <SettingsCard>
        <AccountProfileHeader
          avatarUrl={avatarUrl ?? null}
          displayName={displayName}
          email={email}
          githubLabel={githubLabel}
          profileSummary={profileSummary}
        />
      </SettingsCard>

      <SettingsCard>
        <SettingsCardRow label={accessTitle} description={accessDescription}>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {actions.signIn ? <AccountAction action={actions.signIn} /> : null}
            {actions.connectGitHub ? <AccountAction action={actions.connectGitHub} /> : null}
            {actions.reconnectGitHub ? <AccountAction action={actions.reconnectGitHub} /> : null}
            {actions.manageGitHubAccess ? (
              <AccountAction action={actions.manageGitHubAccess} variant="ghost" />
            ) : null}
            {actions.signOut ? <AccountAction action={actions.signOut} variant="ghost" /> : null}
          </div>
        </SettingsCardRow>
      </SettingsCard>

      <SettingsCard>
        <div className="space-y-3 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-medium text-foreground">{providersTitle}</div>
              <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                {providersDescription}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions.connectGoogle ? (
                <AccountAction action={actions.connectGoogle} variant="secondary" />
              ) : null}
              {actions.connectApple ? (
                <AccountAction action={actions.connectApple} variant="secondary" />
              ) : null}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            {providers.map((provider) => (
              <ProviderRow key={`${provider.provider}-${provider.accountLabel ?? provider.label}`} provider={provider} />
            ))}
          </div>
        </div>
      </SettingsCard>

      {passwordCredential ? (
        <AccountPasswordCredentialCard credential={passwordCredential} />
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function AccountAction({
  action,
  variant = "secondary",
}: {
  action: AccountActionView;
  variant?: "secondary" | "ghost";
}) {
  return (
    <Button
      type="button"
      variant={action.destructive ? "ghost" : variant}
      disabled={action.disabled}
      loading={action.loading}
      onClick={action.onClick}
      className={action.destructive ? "text-destructive hover:text-destructive" : ""}
    >
      {!action.loading && action.icon ? action.icon : null}
      {action.label}
    </Button>
  );
}

function AccountProfileHeader({
  avatarUrl,
  displayName,
  email,
  githubLabel,
  profileSummary,
}: {
  avatarUrl: string | null;
  displayName: string;
  email: string;
  githubLabel: string;
  profileSummary: string;
}) {
  return (
    <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
      <AccountAvatar
        key={avatarUrl ?? "account-avatar"}
        avatarUrl={avatarUrl}
        displayName={displayName}
      />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="min-w-0 space-y-1">
          <div className="truncate text-lg font-medium text-foreground">{displayName}</div>
          <p className="text-sm leading-6 text-muted-foreground">{profileSummary}</p>
        </div>
        <div className="grid gap-2">
          <AccountProfileRow label="Email" value={email} />
          <AccountProfileRow label="GitHub" value={githubLabel} />
        </div>
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

function AccountProfileRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-foreground">{value}</span>
    </div>
  );
}

function ProviderRow({ provider }: { provider: AccountProviderView }) {
  const statusLabel = provider.connected
    ? provider.status === "needs_reauth"
      ? "Reconnect"
      : provider.status === "expired"
        ? "Expired"
        : "Connected"
    : "Not connected";

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border-light px-3 py-2.5 text-sm last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <span>{provider.label}</span>
          {provider.primary && provider.connected ? (
            <Badge tone="neutral">Primary</Badge>
          ) : null}
        </div>
        <div className="truncate text-muted-foreground">
          {provider.accountLabel || (provider.connected ? "Connected" : "Not connected")}
        </div>
      </div>
      <Badge tone={providerStatusTone(provider)} className="shrink-0">
        {statusLabel}
      </Badge>
    </div>
  );
}

function providerStatusTone(provider: AccountProviderView): "neutral" | "success" | "warning" | "destructive" {
  if (!provider.connected) {
    return "neutral";
  }
  if (provider.status === "expired") {
    return "destructive";
  }
  if (provider.status === "needs_reauth") {
    return "warning";
  }
  return "success";
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
