import { useId } from "react";
import type {
  ConnectorCatalogEntry,
  ConnectorSettingValue,
  ConnectorSettings,
  ConnectorSettingsField,
} from "@/lib/domain/mcp/types";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";

export function ConnectorSettingsFields({
  disabled = false,
  entry,
  error,
  helperText,
  onChange,
  settings,
}: {
  disabled?: boolean;
  entry: ConnectorCatalogEntry;
  error?: string | null;
  helperText?: string;
  onChange: (settings: ConnectorSettings) => void;
  settings: ConnectorSettings;
}) {
  if (entry.settingsSchema.length === 0) {
    return null;
  }

  function setFieldValue(fieldId: string, value: ConnectorSettingValue) {
    onChange({ ...settings, [fieldId]: value });
  }

  return (
    <div className="space-y-3">
      {entry.settingsSchema.map((field) => (
        <ConnectorSettingFieldInput
          key={field.id}
          disabled={disabled}
          field={field}
          onChange={(value) => setFieldValue(field.id, value)}
          value={settings[field.id]}
        />
      ))}
      {helperText && <p className="text-xs text-muted-foreground">{helperText}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ConnectorSettingFieldInput({
  disabled,
  field,
  onChange,
  value,
}: {
  disabled: boolean;
  field: ConnectorSettingsField;
  onChange: (value: ConnectorSettingValue) => void;
  value: ConnectorSettingValue | undefined;
}) {
  const inputId = useId();

  if (field.kind === "boolean") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
        <div className="space-y-1">
          <Label htmlFor={inputId}>{field.label}</Label>
          {field.helperText && (
            <p className="text-xs text-muted-foreground">{field.helperText}</p>
          )}
        </div>
        <Switch
          id={inputId}
          checked={value === true}
          onChange={onChange}
          disabled={disabled}
          aria-label={field.label}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{field.label}</Label>
      {field.kind === "select" ? (
        <Select
          id={inputId}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          id={inputId}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          type={field.kind === "url" ? "url" : "text"}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
        />
      )}
      {field.helperText && <p className="text-xs text-muted-foreground">{field.helperText}</p>}
    </div>
  );
}
