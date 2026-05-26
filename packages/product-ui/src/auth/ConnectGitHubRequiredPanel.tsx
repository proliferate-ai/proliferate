import { type ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { AuthLayout } from "./AuthLayout";
import { AuthProviderButton } from "./AuthProviderButton";

interface ConnectGitHubRequiredPanelProps {
  mark?: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  footer: ReactNode;
  actionIcon?: ReactNode;
  actionLabel: ReactNode;
  loading?: boolean;
  error?: ReactNode;
  onConnect: () => void;
  onSignOut: () => void;
}

export function ConnectGitHubRequiredPanel({
  mark,
  title,
  subtitle,
  footer,
  actionIcon,
  actionLabel,
  loading = false,
  error,
  onConnect,
  onSignOut,
}: ConnectGitHubRequiredPanelProps) {
  return (
    <AuthLayout mark={mark} title={title} subtitle={subtitle} footer={footer}>
      <AuthProviderButton
        icon={actionIcon}
        loading={loading}
        disabled={loading}
        variant="primary"
        onClick={onConnect}
      >
        {actionLabel}
      </AuthProviderButton>
      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm leading-5 text-destructive">
          {error}
        </div>
      ) : null}
      <Button
        className="h-10 justify-center text-xs text-muted-foreground"
        variant="ghost"
        onClick={onSignOut}
      >
        Sign out
      </Button>
    </AuthLayout>
  );
}
