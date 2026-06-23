import { useState, type ReactNode } from "react";
import { ChevronDown } from "@proliferate/ui/icons";
import { AuthProviderButton } from "@proliferate/ui/primitives/AuthProviderButton";
import { Button } from "@proliferate/ui/primitives/Button";
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
  secondaryActions?: AuthProviderActionView[];
  secondaryLabel?: ReactNode;
  secondaryContent?: ReactNode;
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
  secondaryActions,
  secondaryLabel = "More",
  secondaryContent,
  note,
  error,
  devAccess,
}: AuthStartPanelProps) {
  const hasSecondaryOptions =
    Boolean(secondaryActions?.length) || secondaryContent !== undefined;

  return (
    <AuthLayout mark={mark} title={title} subtitle={subtitle} footer={footer}>
      {!hasSecondaryOptions ? credentialForm : null}
      {!hasSecondaryOptions && credentialForm ? <AuthDivider /> : null}
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
      {hasSecondaryOptions ? (
        <AuthSecondaryOptions
          label={secondaryLabel}
          actions={secondaryActions ?? []}
          content={secondaryContent}
        />
      ) : null}
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

function AuthSecondaryOptions({
  label,
  actions,
  content,
}: {
  label: ReactNode;
  actions: AuthProviderActionView[];
  content?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="secondary"
        size="md"
        aria-expanded={expanded}
        className="h-11 w-full justify-center gap-2.5"
        onClick={() => setExpanded((current) => !current)}
      >
        <span>{label}</span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </Button>
      {expanded ? (
        <div className="space-y-3">
          {actions.map((action) => (
            <AuthProviderButton
              key={action.id}
              icon={action.icon}
              loading={action.loading}
              disabled={action.disabled}
              variant={action.primary ? "primary" : "secondary"}
              onClick={action.onClick}
            >
              {action.label}
            </AuthProviderButton>
          ))}
          {content ? (
            <>
              {actions.length > 0 ? <AuthDivider /> : null}
              {content}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
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
