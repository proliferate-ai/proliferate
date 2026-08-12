import type { ReactNode } from "react";
import { UserAvatar } from "#product/primitives/UserAvatar";

import { SettingsSection } from "#product/components/patterns/SettingsSection";
import { ProviderBrandIcon } from "#product/components/auth/ProviderBrandIcon";
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
  providersDescription,
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
      {/* Identity sits on the page background, not inside a wash card. */}
      <AccountProfileHeader
        avatarUrl={avatarUrl ?? null}
        displayName={displayName}
        email={email}
        githubLabel={githubLabel}
        profileSummary={profileSummary}
        signOut={actions.signOut}
      />

      <SettingsSection
        title={providersTitle}
        description={signInMethodsDescription}
        action={sectionAction}
      >
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
      </SettingsSection>

      {connectedServices.length > 0 ? (
        <SettingsSection title={connectedServicesTitle} description={connectedServicesDescription}>
          {connectedServices.map((service) => (
            <ConnectedServiceRow key={service.id} service={service} />
          ))}
        </SettingsSection>
      ) : null}

      {error ? <p className="text-ui text-destructive">{error}</p> : null}
    </div>
  );
}

function AccountProfileHeader({
  avatarUrl,
  displayName,
  email,
  githubLabel,
  profileSummary,
  signOut,
}: {
  avatarUrl: string | null;
  displayName: string;
  email: string;
  githubLabel: string;
  profileSummary: string;
  signOut?: AccountActionView;
}) {
  // A GitHub handle reads as "@login"; anything else (a status word like
  // "Not connected" or "Unavailable") isn't an identity to show next to the
  // glyph, so the third line falls back to the profile summary instead.
  const hasGitHubHandle = githubLabel.trim().startsWith("@");

  return (
    <div className="flex items-center gap-4">
      <UserAvatar
        key={avatarUrl ?? "account-avatar"}
        avatarUrl={avatarUrl}
        displayName={displayName}
        className="size-16 shrink-0 rounded-full text-heading font-medium"
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <span className="block truncate text-body-emphasis font-medium text-foreground">
          {displayName}
        </span>
        <div className="truncate text-ui-sm text-muted-foreground">{email}</div>
        {hasGitHubHandle ? (
          <div className="flex items-center gap-1.5 text-ui-sm text-muted-foreground">
            <ProviderBrandIcon provider="github" className="icon-compact shrink-0" />
            <span className="truncate">{githubLabel}</span>
          </div>
        ) : (
          <p className="text-ui-sm text-muted-foreground">{profileSummary}</p>
        )}
      </div>
      {signOut ? (
        <div className="shrink-0">
          <AccountAction action={signOut} variant="secondary" />
        </div>
      ) : null}
    </div>
  );
}
