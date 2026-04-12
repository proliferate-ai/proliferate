import { useId } from "react";
import type { SupabaseConnectorSettings } from "@/lib/domain/mcp/types";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Switch } from "@/components/ui/Switch";

export function SupabaseSettingsFields({
  disabled = false,
  error,
  helperText,
  onChange,
  settings,
}: {
  disabled?: boolean;
  error?: string | null;
  helperText?: string;
  onChange: (settings: SupabaseConnectorSettings) => void;
  settings: SupabaseConnectorSettings;
}) {
  const projectRefId = useId();
  const readOnlyId = useId();

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={projectRefId}>Project ref</Label>
        <Input
          id={projectRefId}
          value={settings.projectRef}
          onChange={(event) => onChange({
            ...settings,
            projectRef: event.target.value,
          })}
          placeholder="abcd1234"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
        />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
        <div className="space-y-1">
          <Label htmlFor={readOnlyId}>Read-only mode</Label>
          <p className="text-xs text-muted-foreground">
            Start in read-only mode unless you explicitly need write access.
          </p>
        </div>
        <Switch
          id={readOnlyId}
          checked={settings.readOnly}
          onChange={(readOnly) => onChange({
            ...settings,
            readOnly,
          })}
          disabled={disabled}
          aria-label="Use Supabase in read-only mode"
        />
      </div>
      {helperText && <p className="text-xs text-muted-foreground">{helperText}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
