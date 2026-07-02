import { useState } from "react";
import { ArrowRight } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { AUTH_LOGIN_LABELS } from "@/copy/auth/auth-copy";

// Minimal email/password form for the sign-in surface. Shown as the default
// when the connected server reports GitHub OAuth is not configured (the
// standard self-hosted posture). Errors are surfaced by the parent screen's
// shared message line, so this component only owns the field state.

interface PasswordSignInFormProps {
  submitting: boolean;
  disabled?: boolean;
  tabbable?: boolean;
  onSubmit: (email: string, password: string) => void;
}

export function PasswordSignInForm({
  submitting,
  disabled = false,
  tabbable = true,
  onSubmit,
}: PasswordSignInFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const fieldsDisabled = disabled || submitting;
  const canSubmit = !fieldsDisabled && email.trim().length > 0 && password.length > 0;

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        onSubmit(email.trim(), password);
      }}
    >
      <Input
        type="email"
        autoComplete="email"
        placeholder={AUTH_LOGIN_LABELS.emailFieldPlaceholder}
        aria-label={AUTH_LOGIN_LABELS.emailFieldLabel}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={fieldsDisabled}
        tabIndex={tabbable ? 0 : -1}
      />
      <Input
        type="password"
        autoComplete="current-password"
        placeholder={AUTH_LOGIN_LABELS.passwordFieldPlaceholder}
        aria-label={AUTH_LOGIN_LABELS.passwordFieldLabel}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        disabled={fieldsDisabled}
        tabIndex={tabbable ? 0 : -1}
      />
      <Button
        type="submit"
        size="md"
        loading={submitting}
        disabled={!canSubmit}
        tabIndex={tabbable ? 0 : -1}
        className="h-11 w-full"
      >
        {submitting ? AUTH_LOGIN_LABELS.passwordWaiting : AUTH_LOGIN_LABELS.passwordSignIn}
        {!submitting && <ArrowRight className="h-4 w-4" />}
      </Button>
    </form>
  );
}
