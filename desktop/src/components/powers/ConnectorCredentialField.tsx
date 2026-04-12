import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ConnectorCatalogEntry } from "@/lib/domain/mcp/types";
import { describeConnectorSecretHint } from "@/lib/domain/mcp/validation";
import { openExternal } from "@/platform/tauri/shell";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { ExternalLink } from "@/components/ui/icons";

export function ConnectorCredentialField({
  actionLabel = "Get token",
  autoFocus = true,
  disabled = false,
  entry,
  error,
  helperOverride,
  onChange,
  showValue = false,
  value,
}: {
  actionLabel?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  entry: ConnectorCatalogEntry;
  error: string | null;
  helperOverride?: string;
  onChange: (value: string) => void;
  showValue?: boolean;
  value: string;
}) {
  const field = entry.requiredFields[0];
  const inputId = useId();
  const [visible, setVisible] = useState(showValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const prefixHint = useMemo(() => describeConnectorSecretHint(entry, value), [entry, value]);

  useEffect(() => {
    setVisible(showValue);
  }, [showValue]);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  if (!field) {
    return null;
  }

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
        <span>{helperOverride ?? field.helperText}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => { void openExternal(entry.docsUrl); }}
          disabled={disabled}
        >
          {actionLabel}
          <ExternalLink className="size-3" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{field.getTokenInstructions}</p>
      {prefixHint && <p className="text-xs text-muted-foreground">{prefixHint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
