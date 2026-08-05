import { Badge, type BadgeTone } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";

export interface SettingsSaveFooterProps {
  statusLabel?: string | null;
  statusTone?: BadgeTone;
  error?: string | null;
  saving?: boolean;
  saveDisabled?: boolean;
  revertDisabled?: boolean;
  onSave: () => void;
  onRevert: () => void;
}

/**
 * Shared save/revert footer for settings editors: optional inline error line,
 * then a right-aligned rail with an optional status badge, a ghost Revert, and
 * the primary Save. Extracted from the cloud environment config editor so all
 * repo-scope pages share one footer anatomy.
 */
export function SettingsSaveFooter({
  statusLabel = null,
  statusTone = "neutral",
  error = null,
  saving = false,
  saveDisabled = false,
  revertDisabled = false,
  onSave,
  onRevert,
}: SettingsSaveFooterProps) {
  return (
    <div>
      {error ? (
        <p className="border-t border-border pt-3 text-ui-sm text-destructive">{error}</p>
      ) : null}
      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        {statusLabel ? <Badge tone={statusTone}>{statusLabel}</Badge> : null}
        <Button
          type="button"
          variant="ghost"
          disabled={revertDisabled || saving}
          onClick={onRevert}
        >
          Revert
        </Button>
        <Button
          type="button"
          loading={saving}
          disabled={saveDisabled}
          onClick={onSave}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
