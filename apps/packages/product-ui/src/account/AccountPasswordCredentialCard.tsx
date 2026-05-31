import { useId, useState, type FormEvent } from "react";

import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";

import { SettingsCard } from "../settings/SettingsCard";

export interface AccountPasswordCredentialSubmit {
  currentPassword?: string;
  newPassword: string;
}

export interface AccountPasswordCredentialView {
  enabled: boolean;
  setAt?: string | null;
  loading?: boolean;
  disabled?: boolean;
  onSubmit?: (input: AccountPasswordCredentialSubmit) => void | Promise<void>;
}

export function AccountPasswordCredentialCard({
  credential,
}: {
  credential: AccountPasswordCredentialView;
}) {
  const [editing, setEditing] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentPasswordId = useId();
  const newPasswordId = useId();
  const confirmPasswordId = useId();
  const needsCurrentPassword = credential.enabled;
  const actionDisabled = credential.loading || credential.disabled || !credential.onSubmit;
  const passwordMismatch = Boolean(newPassword && confirmPassword && newPassword !== confirmPassword);
  const canSubmit = Boolean(
    !actionDisabled
      && !submitting
      && newPassword
      && confirmPassword
      && !passwordMismatch
      && (!needsCurrentPassword || currentPassword),
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionDisabled || submitting) {
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    if (!canSubmit) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await credential.onSubmit?.({
        currentPassword: needsCurrentPassword ? currentPassword : undefined,
        newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setEditing(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Password could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SettingsCard>
      <div className="space-y-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-medium text-foreground">Email/password</div>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              {credential.enabled
                ? "Email sign-in is enabled for this account."
                : credential.loading
                  ? "Checking email sign-in for this account."
                : "Add a password to sign in with email on web and mobile."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone={credential.enabled ? "success" : "neutral"}>
              {credential.loading ? "Checking" : credential.enabled ? "Enabled" : "Not set"}
            </Badge>
            {credential.onSubmit ? (
              <Button
                type="button"
                variant="secondary"
                disabled={actionDisabled || submitting}
                onClick={() => {
                  setError(null);
                  if (editing) {
                    setCurrentPassword("");
                    setNewPassword("");
                    setConfirmPassword("");
                    setEditing(false);
                  } else {
                    setEditing(true);
                  }
                }}
              >
                {editing ? "Cancel" : credential.enabled ? "Change password" : "Set password"}
              </Button>
            ) : null}
          </div>
        </div>

        {editing ? (
          <form className="grid gap-3 sm:max-w-md" onSubmit={submit}>
            {needsCurrentPassword ? (
              <div className="space-y-1.5">
                <Label htmlFor={currentPasswordId}>Current password</Label>
                <Input
                  id={currentPasswordId}
                  type="password"
                  value={currentPassword}
                  disabled={submitting}
                  autoComplete="current-password"
                  data-telemetry-mask
                  onChange={(event) => setCurrentPassword(event.currentTarget.value)}
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor={newPasswordId}>New password</Label>
              <Input
                id={newPasswordId}
                type="password"
                value={newPassword}
                disabled={submitting}
                autoComplete="new-password"
                data-telemetry-mask
                onChange={(event) => setNewPassword(event.currentTarget.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={confirmPasswordId}>Confirm new password</Label>
              <Input
                id={confirmPasswordId}
                type="password"
                value={confirmPassword}
                disabled={submitting}
                autoComplete="new-password"
                data-telemetry-mask
                onChange={(event) => setConfirmPassword(event.currentTarget.value)}
              />
            </div>
            {passwordMismatch ? (
              <p className="text-sm text-destructive" role="alert">
                New passwords do not match.
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                variant="primary"
                loading={submitting}
                disabled={!canSubmit}
              >
                {submitting ? "Saving" : credential.enabled ? "Save password" : "Set password"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={submitting}
                onClick={() => {
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmPassword("");
                  setError(null);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </form>
        ) : null}
      </div>
    </SettingsCard>
  );
}
