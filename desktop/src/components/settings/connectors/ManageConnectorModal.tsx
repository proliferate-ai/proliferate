import { useEffect, useState } from "react";
import type { ConnectorCatalogEntry, InstalledConnectorRecord } from "@/lib/domain/mcp/types";
import { validateConnectorSecretValue } from "@/lib/domain/mcp/validation";
import { useToastStore } from "@/stores/toast/toast-store";
import { Button } from "@/components/ui/Button";
import { ModalShell } from "@/components/ui/ModalShell";
import { DeleteConnectorModal } from "./DeleteConnectorModal";
import { ConnectorCredentialField, ConnectorDetailsBlock } from "./ConnectorShared";

export function ManageConnectorModal({
  onClose,
  onDelete,
  onRetry,
  onSave,
  record,
}: {
  onClose: () => void;
  onDelete: (connectionId: string, catalogEntryId: ConnectorCatalogEntry["id"]) => Promise<void>;
  onRetry: (connectionId: string, catalogEntryId: ConnectorCatalogEntry["id"]) => Promise<boolean>;
  onSave: (
    connectionId: string,
    catalogEntryId: ConnectorCatalogEntry["id"],
    secretValue: string,
  ) => Promise<void>;
  record: InstalledConnectorRecord | null;
}) {
  const showToast = useToastStore((state) => state.show);
  const [secretValue, setSecretValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSecretValue("");
    setError(null);
    setConfirmDeleteOpen(false);
  }, [record?.metadata.connectionId]);

  if (!record) {
    return null;
  }
  const activeRecord = record;
  const hasCredentialField = activeRecord.catalogEntry.requiredFields.length > 0;
  const validationError = hasCredentialField && secretValue
    ? validateConnectorSecretValue(secretValue)
    : null;
  const canSave = hasCredentialField && secretValue.trim().length > 0 && !validationError;

  async function handleSave() {
    if (!canSave) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSave(activeRecord.metadata.connectionId, activeRecord.catalogEntry.id, secretValue);
      showToast(`${activeRecord.catalogEntry.name} updated.`, "info");
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : `Couldn't update ${activeRecord.catalogEntry.name}. Try again.`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetry() {
    setRetrying(true);
    try {
      await onRetry(activeRecord.metadata.connectionId, activeRecord.catalogEntry.id);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <>
      <ModalShell
        open={!!record}
        onClose={onClose}
        disableClose={submitting}
        title={activeRecord.catalogEntry.name}
        description={activeRecord.catalogEntry.oneLiner}
        footer={(
          <>
            <Button
              type="button"
              variant="destructive"
              size="md"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={submitting || retrying}
            >
              Delete
            </Button>
            <Button type="button" variant="ghost" size="md" onClick={onClose} disabled={submitting}>
              {hasCredentialField ? "Cancel" : "Close"}
            </Button>
            {hasCredentialField && (
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={() => { void handleSave(); }}
                loading={submitting}
                disabled={!canSave}
              >
                Save
              </Button>
            )}
          </>
        )}
      >
        <div className="space-y-4">
          {activeRecord.metadata.syncState === "degraded" && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              <span>Cloud sync couldn't finish. We'll retry automatically.</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { void handleRetry(); }}
                disabled={retrying || submitting}
                aria-label={`Retry sync for ${activeRecord.catalogEntry.name}`}
              >
                Retry
              </Button>
            </div>
          )}
          {hasCredentialField ? (
            <ConnectorCredentialField
              entry={activeRecord.catalogEntry}
              error={error}
              helperOverride={activeRecord.broken
                ? "Add a token to use this connector."
                : "Leave blank to keep the current token."}
              onChange={(nextValue) => {
                setSecretValue(nextValue);
                if (error) {
                  setError(null);
                }
              }}
              showValue={false}
              value={secretValue}
              disabled={submitting}
            />
          ) : (
            <ConnectorDetailsBlock entry={activeRecord.catalogEntry} />
          )}
        </div>
      </ModalShell>
      <DeleteConnectorModal
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onDelete={onDelete}
        record={activeRecord}
      />
    </>
  );
}
