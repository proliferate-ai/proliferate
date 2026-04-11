import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ConnectorCatalogEntry, SupabaseConnectorSettings } from "@/lib/domain/mcp/types";
import braveIcon from "@/assets/connector-icons/brave.svg";
import context7Icon from "@/assets/connector-icons/context7.jpeg";
import notionIcon from "@/assets/connector-icons/notion.png";
import openweatherIcon from "@/assets/connector-icons/openweather.svg";
import playwrightIcon from "@/assets/connector-icons/playwright.svg";
import supabaseIcon from "@/assets/connector-icons/supabase.png";
import { describeConnectorSecretHint } from "@/lib/domain/mcp/validation";
import { openExternal } from "@/platform/tauri/shell";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Switch } from "@/components/ui/Switch";
import { ExternalLink, Folder, GitHub, Globe, Search, Sun, Terminal } from "@/components/ui/icons";

const CONNECTOR_ICONS = {
  github: GitHub,
  globe: Globe,
  search: Search,
  sun: Sun,
  folder: Folder,
  terminal: Terminal,
} as const;

const CONNECTOR_ICON_IMAGES = {
  brave: braveIcon,
  context7: context7Icon,
  notion: notionIcon,
  openweather: openweatherIcon,
  playwright: playwrightIcon,
  supabase: supabaseIcon,
} as const;

export function ConnectorIcon({ entry }: { entry: ConnectorCatalogEntry }) {
  const iconImage = entry.iconId in CONNECTOR_ICON_IMAGES
    ? CONNECTOR_ICON_IMAGES[entry.iconId as keyof typeof CONNECTOR_ICON_IMAGES]
    : null;

  if (iconImage) {
    return (
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/35 p-1">
        <img
          src={iconImage}
          alt=""
          aria-hidden="true"
          className="size-full rounded-[5px] object-contain"
        />
      </div>
    );
  }

  const Icon = CONNECTOR_ICONS[entry.iconId as keyof typeof CONNECTOR_ICONS];
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/35 text-foreground">
      <Icon className="size-5 shrink-0" />
    </div>
  );
}

export function ConnectorDetailsBlock({
  entry,
}: {
  entry: ConnectorCatalogEntry;
}) {
  const helperText = entry.transport === "http" && entry.authKind === "oauth"
    ? "You'll finish setup in your browser."
    : "This connector doesn't need any saved credentials.";
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{entry.description}</p>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{helperText}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => { void openExternal(entry.docsUrl); }}
        >
          Learn more
          <ExternalLink className="size-3" />
        </Button>
      </div>
    </div>
  );
}

export function ConnectorCredentialField({
  actionLabel = "Get token",
  disabled = false,
  entry,
  error,
  helperOverride,
  onChange,
  showValue,
  value,
}: {
  actionLabel?: string;
  disabled?: boolean;
  entry: ConnectorCatalogEntry;
  error: string | null;
  helperOverride?: string;
  onChange: (value: string) => void;
  showValue: boolean;
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
    inputRef.current?.focus();
  }, []);

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
