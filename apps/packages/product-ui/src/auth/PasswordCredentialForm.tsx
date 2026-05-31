import { type FormEvent, type ReactNode, useId } from "react";

import { AUTH_PASSWORD_COPY } from "@proliferate/product-domain/auth/presentation";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";

export interface PasswordCredentialFormProps {
  email: string;
  password: string;
  submitting?: boolean;
  disabled?: boolean;
  error?: ReactNode;
  submitLabel?: string;
  busyLabel?: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}

export function PasswordCredentialForm({
  email,
  password,
  submitting = false,
  disabled = false,
  error,
  submitLabel = AUTH_PASSWORD_COPY.submitLabel,
  busyLabel = AUTH_PASSWORD_COPY.busyLabel,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: PasswordCredentialFormProps) {
  const formDisabled = disabled || submitting;
  const emailId = useId();
  const passwordId = useId();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formDisabled) {
      onSubmit();
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="space-y-1.5">
        <Label className="font-medium" htmlFor={emailId}>
          {AUTH_PASSWORD_COPY.emailLabel}
        </Label>
        <Input
          id={emailId}
          type="email"
          value={email}
          disabled={formDisabled}
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect="off"
          inputMode="email"
          placeholder={AUTH_PASSWORD_COPY.emailPlaceholder}
          data-telemetry-mask
          onChange={(event) => onEmailChange(event.currentTarget.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="font-medium" htmlFor={passwordId}>
          {AUTH_PASSWORD_COPY.passwordLabel}
        </Label>
        <Input
          id={passwordId}
          type="password"
          value={password}
          disabled={formDisabled}
          autoComplete="current-password"
          placeholder={AUTH_PASSWORD_COPY.passwordPlaceholder}
          data-telemetry-mask
          onChange={(event) => onPasswordChange(event.currentTarget.value)}
        />
      </div>
      {error ? (
        <p className="text-sm leading-5 text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="primary"
        size="md"
        loading={submitting}
        disabled={formDisabled || !email.trim() || !password}
        className="w-full"
      >
        {submitting ? busyLabel : submitLabel}
      </Button>
    </form>
  );
}
