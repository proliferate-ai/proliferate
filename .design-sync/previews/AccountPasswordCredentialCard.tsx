import { useEffect, useRef, type ReactNode } from "react";
import { AccountPasswordCredentialCard, SettingsSection } from "@proliferate/ui";

const noop = () => {};

/**
 * The card export is a compatibility alias for the inline row, so it is always
 * photographed inside the sign-in-methods surface it is designed to sit in.
 */
const MethodsCard = ({ children }: { children: ReactNode }) => (
  <div className="w-full max-w-2xl">
    <SettingsSection
      title="Sign-in methods"
      description="How you sign in to this account across desktop, web, and mobile."
    >
      <div className="overflow-clip rounded-lg bg-surface-elevated-secondary">
        {children}
      </div>
    </SettingsSection>
  </div>
);

/** Clicks the card's own trigger once mounted so the expand-in-place form photographs. */
const ExpandOnMount = ({ children }: { children: ReactNode }) => {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      host.current?.querySelector("button")?.click();
    }, 60);
    return () => window.clearTimeout(timer);
  }, []);
  return <div ref={host}>{children}</div>;
};

export const PasswordEnabled = () => (
  <MethodsCard>
    <AccountPasswordCredentialCard
      credential={{
        enabled: true,
        setAt: "2026-05-14T09:12:00.000Z",
        onSubmit: noop,
      }}
    />
  </MethodsCard>
);

export const NoPasswordYet = () => (
  <MethodsCard>
    <AccountPasswordCredentialCard
      credential={{ enabled: false, setAt: null, onSubmit: noop }}
    />
  </MethodsCard>
);

export const ChangePasswordForm = () => (
  <MethodsCard>
    <ExpandOnMount>
      <AccountPasswordCredentialCard
        credential={{
          enabled: true,
          setAt: "2026-05-14T09:12:00.000Z",
          onSubmit: noop,
        }}
      />
    </ExpandOnMount>
  </MethodsCard>
);

export const CheckingCredential = () => (
  <MethodsCard>
    <AccountPasswordCredentialCard
      credential={{ enabled: false, loading: true, onSubmit: noop }}
    />
  </MethodsCard>
);
