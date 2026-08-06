import type { ReactNode } from "react";
import { UserAvatar } from "#product/primitives/UserAvatar";

import { SettingsSection } from "#product/components/patterns/SettingsSection";
import type { AccountProviderView } from "#product/lib/domain/auth/account-profile-presentation";
import {
  AccountPasswordCredentialRow,
  type AccountPasswordCredentialView,
} from "#product/components/settings/panes/account/AccountPasswordCredentialCard";
import {
  AccountAction,
  buildEffectiveProviders,
  ConnectedServiceRow,
  SignInMethodRow,
} from "#product/components/settings/panes/account/AccountSignInMethods";

export type {
  AccountPasswordCredentialSubmit,
  AccountPasswordCredentialView,
} from "#product/components/settings/panes/account/AccountPasswordCredentialCard";

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
        <div className="overflow-clip rounded-lg bg-surface-elevated-secondary">
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
          <div className="overflow-clip rounded-lg bg-surface-elevated-secondary">
            {connectedServices.map((service) => (
              <ConnectedServiceRow key={service.id} service={service} />
            ))}
          </div>
        </SettingsSection>
      ) : null}

      {/* 4. Footer */}
      {error ? <p className="text-ui text-destructive">{error}</p> : null}
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
      <UserAvatar
        key={avatarUrl ?? "account-avatar"}
        avatarUrl={avatarUrl}
        displayName={displayName}
        className="size-16 rounded-full text-title font-medium"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="truncate text-title font-medium text-foreground">{displayName}</div>
        <div className="truncate text-body text-muted-foreground">{email}</div>
        <p className="text-body text-muted-foreground">{profileSummary}</p>
      </div>
    </div>
  );
}
