import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { isValidEnvVarName } from "@/lib/domain/settings/harness-auth-sources";

export interface ApiKeyCreatorSubmit {
  /** Human label for the vault key. Empty when the title field is hidden. */
  title: string;
  /** The write-only secret value. */
  value: string;
  /** SCREAMING_SNAKE_CASE env var name / secret name. Empty when hidden. */
  envVarName: string;
}

/** Optional env-var (agent binding) / secret-name field. */
export interface ApiKeyCreatorEnvVarField {
  label: string;
  placeholder?: string;
  /** Prefilled value (e.g. the harness env-var suggestion). */
  initialValue?: string;
  helpText?: string;
}

export interface ApiKeyCreatorModalProps {
  open: boolean;
  onClose: () => void;
  heading: string;
  description?: string;
  /** Show the human-label "Title" field (agent vault keys). */
  showTitleField: boolean;
  titleLabel?: string;
  titlePlaceholder?: string;
  valueLabel?: string;
  valuePlaceholder?: string;
  /** When present, renders a validated SCREAMING_SNAKE_CASE name field. */
  envVarField?: ApiKeyCreatorEnvVarField;
  submitLabel: string;
  submitting: boolean;
  error?: string | null;
  onSubmit: (input: ApiKeyCreatorSubmit) => void;
}

/**
 * Shared "Add API key" modal. Collects a titled secret and — when
 * {@link ApiKeyCreatorModalProps.envVarField} is supplied — a validated env-var
 * / secret name, then hands the values to the caller's `onSubmit`. Presentation
 * only: each context (agent vault-key + binding, secrets `putEnvVar`) owns its
 * own mutation so the same shell serves both.
 */
export function ApiKeyCreatorModal({
  open,
  onClose,
  heading,
  description,
  showTitleField,
  titleLabel = "Title",
  titlePlaceholder = "Personal Anthropic API key",
  valueLabel = "Value",
  valuePlaceholder = "sk-...",
  envVarField,
  submitLabel,
  submitting,
  error = null,
  onSubmit,
}: ApiKeyCreatorModalProps) {
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [envVarName, setEnvVarName] = useState("");

  // Reset the form each time the modal opens so a prior draft never leaks in,
  // and seed the env-var field from the caller's suggestion.
  useEffect(() => {
    if (!open) {
      return;
    }
    setTitle("");
    setValue("");
    setEnvVarName(envVarField?.initialValue ?? "");
  }, [open, envVarField?.initialValue]);

  const trimmedTitle = title.trim();
  const trimmedEnvVar = envVarName.trim();
  const invalidEnvVar =
    envVarField !== undefined && trimmedEnvVar.length > 0 && !isValidEnvVarName(trimmedEnvVar);
  const canSubmit =
    value.trim().length > 0
    && (!showTitleField || trimmedTitle.length > 0)
    && (envVarField === undefined || isValidEnvVarName(trimmedEnvVar))
    && !submitting;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    onSubmit({
      title: trimmedTitle,
      value: value.trim(),
      envVarName: envVarField === undefined ? "" : trimmedEnvVar,
    });
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      disableClose={submitting}
      telemetryBlocked
      title={heading}
      description={description}
      sizeClassName="max-w-lg"
      footer={(
        <>
          <Button type="button" variant="ghost" disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="api-key-creator-form"
            loading={submitting}
            disabled={!canSubmit}
          >
            {submitLabel}
          </Button>
        </>
      )}
    >
      <form id="api-key-creator-form" className="space-y-4" onSubmit={submit}>
        {showTitleField ? (
          <div className="space-y-1.5">
            <Label htmlFor="api-key-title" className="text-sm font-medium text-foreground">
              {titleLabel}
            </Label>
            <Input
              id="api-key-title"
              value={title}
              autoComplete="off"
              spellCheck={false}
              placeholder={titlePlaceholder}
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </div>
        ) : null}

        {envVarField ? (
          <div className="space-y-1.5">
            <Label htmlFor="api-key-env-var" className="text-sm font-medium text-foreground">
              {envVarField.label}
            </Label>
            <Input
              id="api-key-env-var"
              value={envVarName}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={invalidEnvVar || undefined}
              placeholder={envVarField.placeholder ?? "ENV_VAR_NAME"}
              className="font-mono"
              onChange={(event) => setEnvVarName(event.currentTarget.value)}
            />
            <p
              className={`text-xs ${invalidEnvVar ? "text-destructive" : "text-muted-foreground"}`}
            >
              {invalidEnvVar
                ? "Use SCREAMING_SNAKE_CASE (A–Z, 0–9, _)."
                : envVarField.helpText ?? "Use SCREAMING_SNAKE_CASE (A–Z, 0–9, _)."}
            </p>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="api-key-value" className="text-sm font-medium text-foreground">
            {valueLabel}
          </Label>
          <Input
            id="api-key-value"
            type="password"
            value={value}
            data-telemetry-mask
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            placeholder={valuePlaceholder}
            onChange={(event) => setValue(event.currentTarget.value)}
          />
          <p className="text-xs text-muted-foreground">
            Stored encrypted. The value is never displayed again after saving.
          </p>
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/25 bg-destructive-subtle px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
      </form>
    </ModalShell>
  );
}
