import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import {
  getProviderConfigFieldSpec,
  type ProviderConfigFieldSpec,
  type ProviderConfigKind,
} from "#product/lib/domain/settings/provider-config-fields";

export interface ProviderConfigCreatorSubmit {
  /** Human label for the vault key, same role as ApiKeyCreatorModal's title. */
  title: string;
  /** The typed provider-config kind this payload was collected for. */
  kind: ProviderConfigKind;
  /** field key -> entered value, keyed by the spec's `fields[].key`. */
  value: Record<string, string>;
}

export interface ProviderConfigCreatorModalProps {
  open: boolean;
  onClose: () => void;
  kind: ProviderConfigKind;
  titleLabel?: string;
  titlePlaceholder?: string;
  submitLabel: string;
  submitting: boolean;
  error?: string | null;
  onSubmit: (input: ProviderConfigCreatorSubmit) => void;
}

/**
 * Multi-field sibling of {@link ApiKeyCreatorModal} for typed provider
 * configs (Bedrock, Azure OpenAI, …): renders N named fields declared by
 * {@link getProviderConfigFieldSpec} instead of ApiKeyCreatorModal's single
 * secret string, then hands a keyed value map to the caller's `onSubmit`.
 * Copies ApiKeyCreatorModal's shell/footer/reset pattern exactly — same
 * `ModalShell`, same form-id-on-footer-button wiring, same reset-on-open
 * effect — so this reads as ApiKeyCreatorModal's shape stretched to N fields,
 * not a new pattern.
 *
 * D1/D3 SEAM: the field spec comes from `getProviderConfigFieldSpec`, a pure
 * function of `kind` — see that module's header comment. This component
 * never reads the registry directly, so D3's registry cutover cannot touch
 * this file.
 */
export function ProviderConfigCreatorModal({
  open,
  onClose,
  kind,
  titleLabel = "Title",
  titlePlaceholder = "Personal Bedrock account",
  submitLabel,
  submitting,
  error = null,
  onSubmit,
}: ProviderConfigCreatorModalProps) {
  const spec = getProviderConfigFieldSpec(kind);
  const [title, setTitle] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});

  // Reset the form each time the modal opens (or the kind changes under an
  // already-open modal) so a prior draft never leaks in, mirroring
  // ApiKeyCreatorModal's reset effect.
  useEffect(() => {
    if (!open) {
      return;
    }
    setTitle("");
    setValues({});
  }, [open, kind]);

  const trimmedTitle = title.trim();
  const missingRequired = spec.fields.some(
    (field) => field.required && (values[field.key] ?? "").trim().length === 0,
  );
  const canSubmit = trimmedTitle.length > 0 && !missingRequired && !submitting;

  function setFieldValue(key: string, next: string) {
    setValues((prev) => ({ ...prev, [key]: next }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    const trimmedValues: Record<string, string> = {};
    for (const field of spec.fields) {
      trimmedValues[field.key] = (values[field.key] ?? "").trim();
    }
    onSubmit({ title: trimmedTitle, kind, value: trimmedValues });
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      disableClose={submitting}
      telemetryBlocked
      title={spec.displayName}
      description={spec.description}
      sizeClassName="max-w-lg"
      footer={(
        <>
          <Button type="button" variant="ghost" disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="provider-config-creator-form"
            loading={submitting}
            disabled={!canSubmit}
          >
            {submitLabel}
          </Button>
        </>
      )}
    >
      <form id="provider-config-creator-form" className="space-y-4" onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor="provider-config-title" className="text-ui font-medium text-foreground">
            {titleLabel}
          </Label>
          <Input
            id="provider-config-title"
            value={title}
            autoComplete="off"
            spellCheck={false}
            placeholder={titlePlaceholder}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </div>

        {spec.fields.map((field) => (
          <ProviderConfigField
            key={field.key}
            field={field}
            value={values[field.key] ?? ""}
            onChange={(next) => setFieldValue(field.key, next)}
          />
        ))}

        <p className="text-ui-sm text-muted-foreground">
          Stored encrypted. Secret values are never displayed again after saving.
        </p>

        {error ? (
          <div className="rounded-md border border-destructive/25 bg-destructive-subtle px-3 py-2 text-ui text-destructive">
            {error}
          </div>
        ) : null}
      </form>
    </ModalShell>
  );
}

function ProviderConfigField({
  field,
  value,
  onChange,
}: {
  field: ProviderConfigFieldSpec;
  value: string;
  onChange: (next: string) => void;
}) {
  const inputId = `provider-config-field-${field.key}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId} className="text-ui font-medium text-foreground">
        {field.label}
        {field.required ? null : (
          <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
        )}
      </Label>
      <Input
        id={inputId}
        type={field.secret ? "password" : "text"}
        value={value}
        data-telemetry-mask={field.secret ? true : undefined}
        autoComplete="off"
        spellCheck={false}
        className={field.secret ? "font-mono" : undefined}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {field.helpText ? (
        <p className="text-ui-sm text-muted-foreground">{field.helpText}</p>
      ) : null}
    </div>
  );
}
