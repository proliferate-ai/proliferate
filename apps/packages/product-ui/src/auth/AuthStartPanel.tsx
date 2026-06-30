import { type ReactNode } from "react";
import { AuthProviderButton } from "@proliferate/ui/primitives/AuthProviderButton";
import { AuthLayout } from "./AuthLayout";

export interface AuthProviderActionView {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  primary?: boolean;
  onClick: () => void;
}

interface AuthStartPanelProps {
  mark?: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  footer: ReactNode;
  providers: AuthProviderActionView[];
  credentialForm?: ReactNode;
  note?: ReactNode;
  error?: ReactNode;
  devAccess?: ReactNode;
}

export function AuthStartPanel({
  mark,
  title,
  subtitle,
  footer,
  providers,
  credentialForm,
  note,
  error,
  devAccess,
}: AuthStartPanelProps) {
  return (
    <AuthLayout mark={mark} title={title} subtitle={subtitle} footer={footer}>
      {credentialForm}
      {credentialForm ? <AuthDivider /> : null}
      {providers.map((provider) => (
        <AuthProviderButton
          key={provider.id}
          icon={provider.icon}
          loading={provider.loading}
          disabled={provider.disabled}
          variant={provider.primary ? "primary" : "secondary"}
          onClick={provider.onClick}
        >
          {provider.label}
        </AuthProviderButton>
      ))}
      {note ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{note}</p> : null}
      {error ? (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm leading-5 text-destructive"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      {devAccess}
    </AuthLayout>
  );
}

function AuthDivider() {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <div className="h-px flex-1 bg-border-light" />
      <span className="text-[11px] uppercase tracking-wide text-faint">or</span>
      <div className="h-px flex-1 bg-border-light" />
    </div>
  );
}
