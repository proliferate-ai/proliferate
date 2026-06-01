
import { ExternalLink } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type {
  PluginCatalogFieldView,
  PluginConnectionDraft,
  PluginInventoryItem,
  PluginSettingValue,
  PluginSettings,
  PluginSettingsFieldView,
} from "@proliferate/product-domain/plugins/cloud-plugin-inventory";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { Select } from "@proliferate/ui/primitives/Select";
import { Switch } from "@proliferate/ui/primitives/Switch";
import type { PluginModalMode } from "./plugin-types";

export function PluginSettingsFields({
  fields,
  helperText,
  settings,
  disabled,
  onChange,
}: {
  fields: readonly PluginSettingsFieldView[];
  helperText?: string;
  settings: PluginSettings | undefined;
  disabled: boolean;
  onChange: (settings: PluginSettings | undefined) => void;
}) {
  if (fields.length === 0) {
    return null;
  }

  function setValue(field: PluginSettingsFieldView, value: PluginSettingValue) {
    onChange({
      ...(settings ?? {}),
      [field.id]: value,
    });
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">Configuration</div>
      {helperText ? <p className="text-xs text-muted-foreground">{helperText}</p> : null}
      {fields.map((field) => (
        <div key={field.id}>
          <Label htmlFor={`plugin-setting-${field.id}`}>{field.label}</Label>
          {field.kind === "boolean" ? (
            <Switch
              id={`plugin-setting-${field.id}`}
              checked={Boolean(settings?.[field.id])}
              disabled={disabled}
              onChange={(checked) => setValue(field, checked)}
            />
          ) : field.kind === "select" ? (
            <Select
              id={`plugin-setting-${field.id}`}
              value={String(settings?.[field.id] ?? "")}
              disabled={disabled}
              onChange={(event) => setValue(field, event.target.value)}
            >
              <option value="" disabled>
                Select {field.label}
              </option>
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              id={`plugin-setting-${field.id}`}
              value={String(settings?.[field.id] ?? "")}
              placeholder={field.placeholder}
              disabled={disabled}
              onChange={(event) => setValue(field, event.target.value)}
            />
          )}
          {field.helperText ? (
            <p className="mt-1 text-xs text-muted-foreground">{field.helperText}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function PluginSecretFields({
  autoFocus,
  item,
  draft,
  mode,
  disabled,
  onChange,
  onOpenDocs,
}: {
  autoFocus: boolean;
  item: PluginInventoryItem;
  draft: PluginConnectionDraft;
  mode: PluginModalMode;
  disabled: boolean;
  onChange: (fieldId: string, value: string) => void;
  onOpenDocs: (url: string) => void;
}) {
  const fields = item.entry.secretFields.length > 0
    ? item.entry.secretFields
    : item.entry.requiredFields;
  if (fields.length === 0 || item.entry.authKind === "oauth") {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">
        {mode === "manage" ? "Replace token" : "Token"}
      </div>
      {fields.map((field, index) => (
        <PluginSecretFieldInput
          key={field.id}
          autoFocus={autoFocus && index === 0}
          disabled={disabled}
          docsUrl={item.entry.docsUrl}
          field={field}
          value={draft.secretFields[field.id] ?? ""}
          onChange={(value) => onChange(field.id, value)}
          onOpenDocs={onOpenDocs}
        />
      ))}
    </div>
  );
}

function PluginSecretFieldInput({
  autoFocus,
  disabled,
  docsUrl,
  field,
  onChange,
  onOpenDocs,
  value,
}: {
  autoFocus: boolean;
  disabled: boolean;
  docsUrl: string;
  field: PluginCatalogFieldView;
  onChange: (value: string) => void;
  onOpenDocs: (url: string) => void;
  value: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [visible, setVisible] = useState(false);
  const hint = pluginFieldPrefixHint(field, value);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor={inputId}>{field.label}</Label>
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            id={inputId}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={field.placeholder}
            type={visible ? "text" : "password"}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={disabled}
            data-telemetry-mask
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setVisible((current) => !current)}
            disabled={disabled}
          >
            {visible ? "Hide" : "Show"}
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{field.helperText}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onOpenDocs(docsUrl)}
          disabled={disabled}
        >
          Get token
          <ExternalLink size={12} />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{field.getTokenInstructions}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function pluginFieldPrefixHint(field: PluginCatalogFieldView, value: string): string | null {
  const normalized = value.trim();
  if (!field.prefixHint || !normalized || normalized.startsWith(field.prefixHint)) {
    return null;
  }
  return `Usually starts with ${field.prefixHint}`;
}
