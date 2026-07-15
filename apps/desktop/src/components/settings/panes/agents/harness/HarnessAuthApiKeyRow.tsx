import { useEffect, useRef, useState } from "react";
import type { AgentApiKey } from "@proliferate/cloud-sdk";
import { Pencil, Trash } from "@proliferate/ui/icons";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { Input } from "@proliferate/ui/primitives/Input";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { KeyPicker } from "@/components/settings/panes/agent-auth/KeyPicker";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import {
  isRowComplete,
  isValidEnvVarName,
  type EditableApiKeyRow,
} from "@/lib/domain/settings/harness-auth-sources";

interface HarnessAuthApiKeyRowProps {
  row: EditableApiKeyRow;
  apiKeys: AgentApiKey[];
  busy: boolean;
  onEnvVarChange: (uid: string, envVarName: string) => void;
  onEnvVarBlur: () => void;
  onKeySelect: (uid: string, keyId: string) => void;
  onEnabledToggle: (uid: string, next: boolean) => void;
  onRemove: (uid: string) => void;
}

/** One `[ENV_VAR_NAME] [key dropdown] [enabled switch] [remove]` row (contract §7). */
export function HarnessAuthApiKeyRow({
  row,
  apiKeys,
  busy,
  onEnvVarChange,
  onEnvVarBlur,
  onKeySelect,
  onEnabledToggle,
  onRemove,
}: HarnessAuthApiKeyRowProps) {
  const invalidName = row.envVarName.length > 0 && !isValidEnvVarName(row.envVarName);
  // New rows (no env var yet) start in edit mode; existing rows start read-only.
  const isNewRow = row.uid.startsWith("draft-") && row.envVarName.length === 0;
  const [editing, setEditing] = useState(isNewRow);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  function handleEditBlur() {
    onEnvVarBlur();
    // Only exit edit mode if the name is valid (or empty for a new row that just lost focus).
    if (!invalidName) {
      setEditing(false);
    }
  }

  function handleEditKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleEditBlur();
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border py-3 first:border-t-0 sm:flex-row sm:items-start">
      <div className="sm:w-56">
        {editing ? (
          <>
            <Input
              ref={inputRef}
              aria-label="Environment variable name"
              placeholder={HARNESS_PANE_COPY.envVarPlaceholder}
              value={row.envVarName}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-invalid={invalidName || undefined}
              onChange={(event) => onEnvVarChange(row.uid, event.target.value)}
              onBlur={handleEditBlur}
              onKeyDown={handleEditKeyDown}
              className="font-mono"
            />
            {invalidName ? (
              <p className="mt-1 text-xs text-destructive">
                Use SCREAMING_SNAKE_CASE (A-Z, 0-9, _).
              </p>
            ) : null}
          </>
        ) : (
          <div className="flex items-center gap-1.5">
            <span
              className="truncate rounded bg-accent px-2 py-1.5 font-mono text-xs text-muted-foreground"
              title={row.envVarName}
            >
              {row.envVarName || HARNESS_PANE_COPY.envVarPlaceholder}
            </span>
            <IconButton
              aria-label="Edit variable name"
              title="Edit variable name"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-3" />
            </IconButton>
          </div>
        )}
      </div>
      <div className="sm:w-56">
        <KeyPicker
          keys={apiKeys}
          selectedKeyId={row.apiKeyId}
          disabled={busy}
          onSelect={(keyId) => onKeySelect(row.uid, keyId)}
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Switch
          aria-label={`Enable ${row.envVarName || "variable"}`}
          checked={row.enabled}
          disabled={!isRowComplete(row) || busy}
          onChange={(next) => onEnabledToggle(row.uid, next)}
        />
        <IconButton
          aria-label={HARNESS_PANE_COPY.removeVariable}
          title={HARNESS_PANE_COPY.removeVariable}
          disabled={busy}
          onClick={() => onRemove(row.uid)}
        >
          <Trash className="size-3.5" />
        </IconButton>
      </div>
    </div>
  );
}
