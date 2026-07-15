import { useState, type ReactNode } from "react";

import { SettingsSection } from "../settings/SettingsSection";
import {
  AccountPasswordCredentialRow,
  type AccountPasswordCredentialView,
} from "./AccountPasswordCredentialCard";
import {
  AccountAction,
  buildEffectiveProviders,
  ConnectedServiceRow,
  SignInMethodRow,
} from "./AccountSignInMethods";

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
