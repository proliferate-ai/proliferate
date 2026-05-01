import { useEffect, useId, useRef, useState } from "react";
import { getConnectorSecretFields } from "@/lib/domain/mcp/catalog";
import type { ConnectorCatalogEntry, ConnectorCatalogField } from "@/lib/domain/mcp/types";
import { openExternal } from "@/platform/tauri/shell";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { ExternalLink } from "@/components/ui/icons";

export function ConnectorSecretFields({
  autoFocus = true,
  disabled = false,
  entry,
  error,
  onChange,
  values,
}: {
  autoFocus?: boolean;
  disabled?: boolean;
  entry: ConnectorCatalogEntry;
  error: string | null;
  onChange: (fieldId: string, value: string) => void;
  values: Record<string, string>;
}) {
  const fields = getConnectorSecretFields(entry);
  if (fields.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {fields.map((field, index) => (
        <ConnectorSecretFieldInput
          key={field.id}
          autoFocus={autoFocus && index === 0}
          disabled={disabled}
          docsUrl={entry.docsUrl}
          error={index === fields.length - 1 ? error : null}
          field={field}
          onChange={(value) => onChange(field.id, value)}
          value={values[field.id] ?? ""}
        />
      ))}
    </div>
  );
}

function ConnectorSecretFieldInput({
  autoFocus,
  disabled,
  docsUrl,
  error,
  field,
  onChange,
  value,
}: {
  autoFocus: boolean;
  disabled: boolean;
  docsUrl: string;
  error: string | null;
  field: ConnectorCatalogField;
  onChange: (value: string) => void;
  value: string;
}) {
  const inputId = useId();
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hint = describeFieldPrefixHint(field, value);

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
          onClick={() => { void openExternal(docsUrl); }}
          disabled={disabled}
        >
          Get token
          <ExternalLink className="size-3" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{field.getTokenInstructions}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function describeFieldPrefixHint(field: ConnectorCatalogField, value: string): string | null {
  const normalized = value.trim();
  if (!field.prefixHint || !normalized || normalized.startsWith(field.prefixHint)) {
    return null;
  }
  return `Usually starts with ${field.prefixHint}`;
}
