import { type ReactNode } from "react";
import { AuthLayout } from "./AuthLayout";
import { AuthProviderButton } from "./AuthProviderButton";

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
  note,
  error,
  devAccess,
}: AuthStartPanelProps) {
  return (
    <AuthLayout mark={mark} title={title} subtitle={subtitle} footer={footer}>
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
      {note ? <p className="mt-2 text-center text-xs leading-5 text-muted-foreground">{note}</p> : null}
      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm leading-5 text-destructive">
          {error}
        </div>
      ) : null}
      {devAccess}
    </AuthLayout>
  );
}
