import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@proliferate/ui/kit/Dialog";
import { Button } from "@proliferate/ui/primitives/Button";
import { Checkbox } from "@proliferate/ui/primitives/Checkbox";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { Select } from "@proliferate/ui/primitives/Select";
import type {
  IntegrationCatalogSettingField,
} from "@proliferate/cloud-sdk/client/integrations";
import type { CloudIntegrationView } from "@/lib/domain/cloud/integrations";

export interface IntegrationConnectSubmit {
  apiKey: string;
  settings: Record<string, unknown> | null;
}

interface IntegrationConnectDialogProps {
  /** The api_key integration being connected; null keeps the dialog closed. */
  integration: CloudIntegrationView | null;
  connecting: boolean;
  onClose: () => void;
  onSubmit: (input: IntegrationConnectSubmit) => void;
}

/**
 * API-key connect form: the definition's secret fields plus its required
 * settings fields, driven entirely by the catalog connect schema. The server
 * stores the (single) API key under the definition's first secret field.
 */
export function IntegrationConnectDialog({
  integration,
  connecting,
  onClose,
  onSubmit,
}: IntegrationConnectDialogProps) {
  const requiredSettingsFields = useMemo(
    () => (integration?.connectSchema.settingsFields ?? []).filter((field) => field.required),
    [integration],
  );
  const secretFields = integration?.connectSchema.secretFields ?? [];

  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [settingsValues, setSettingsValues] = useState<Record<string, string | boolean>>({});

  // Reset the form whenever a different integration opens the dialog.
  const definitionId = integration?.definitionId ?? null;
  useEffect(() => {
    setSecretValues({});
    setSettingsValues(definitionId === null
      ? {}
      : settingsDefaults(requiredSettingsFields));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by open target
  }, [definitionId]);

  const missingSecret = secretFields.some((field) => !(secretValues[field.id] ?? "").trim());
  const missingSetting = requiredSettingsFields.some((field) => {
    if (field.kind === "boolean") {
      return false;
    }
    const value = settingsValues[field.id];
    return typeof value !== "string" || value.trim() === "";
  });
  const canSubmit = secretFields.length > 0 && !missingSecret && !missingSetting && !connecting;

  function handleSubmit() {
    if (!canSubmit || secretFields.length === 0) {
      return;
    }
    const apiKey = (secretValues[secretFields[0].id] ?? "").trim();
    const settings = requiredSettingsFields.length > 0
      ? Object.fromEntries(requiredSettingsFields.map((field) => [
        field.id,
        field.kind === "boolean"
          ? settingsValues[field.id] === true
          : String(settingsValues[field.id] ?? "").trim(),
      ]))
      : null;
    onSubmit({ apiKey, settings });
  }

  return (
    <Dialog
      open={integration !== null}
      onOpenChange={(open) => {
        if (!open && !connecting) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {integration?.displayName ?? "integration"}</DialogTitle>
          <DialogDescription>
            {integration?.description ?? "Provide the credentials this integration needs."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          {secretFields.map((field) => (
            <div key={field.id}>
              <Label htmlFor={`integration-secret-${field.id}`}>{field.label}</Label>
              <Input
                id={`integration-secret-${field.id}`}
                type="password"
                autoComplete="off"
                placeholder={field.placeholder ?? undefined}
                value={secretValues[field.id] ?? ""}
                onChange={(event) => {
                  setSecretValues((previous) => ({
                    ...previous,
                    [field.id]: event.target.value,
                  }));
                }}
              />
              {field.helperText ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {field.helperText}
                </p>
              ) : null}
            </div>
          ))}

          {requiredSettingsFields.map((field) => (
            <IntegrationSettingFieldInput
              key={field.id}
              field={field}
              value={settingsValues[field.id]}
              onChange={(value) => {
                setSettingsValues((previous) => ({ ...previous, [field.id]: value }));
              }}
            />
          ))}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={connecting} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={connecting} disabled={!canSubmit}>
              Connect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IntegrationSettingFieldInput({
  field,
  value,
  onChange,
}: {
  field: IntegrationCatalogSettingField;
  value: string | boolean | undefined;
  onChange: (value: string | boolean) => void;
}) {
  const inputId = `integration-setting-${field.id}`;
  if (field.kind === "boolean") {
    return (
      <Label className="flex items-center gap-2 text-sm text-foreground" htmlFor={inputId}>
        <Checkbox
          id={inputId}
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
        {field.label}
      </Label>
    );
  }
  if (field.kind === "select") {
    return (
      <div>
        <Label htmlFor={inputId}>{field.label}</Label>
        <Select
          id={inputId}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="" disabled>Select...</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Select>
      </div>
    );
  }
  return (
    <div>
      <Label htmlFor={inputId}>{field.label}</Label>
      <Input
        id={inputId}
        type={field.kind === "url" ? "url" : "text"}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function settingsDefaults(
  fields: IntegrationCatalogSettingField[],
): Record<string, string | boolean> {
  return Object.fromEntries(
    fields.flatMap((field) => (field.default === null ? [] : [[field.id, field.default]])),
  );
}
