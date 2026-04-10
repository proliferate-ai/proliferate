import { useEffect, useState } from "react";
import type { ConnectorCatalogEntry } from "@/lib/domain/mcp/types";
import { validateConnectorSecretValue } from "@/lib/domain/mcp/validation";
import { useToastStore } from "@/stores/toast/toast-store";
import { Button } from "@/components/ui/Button";
import { ModalShell } from "@/components/ui/ModalShell";
import { ConnectorCredentialField, ConnectorDetailsBlock } from "./ConnectorShared";

export function InstallConnectorModal({
  entry,
  onClose,
  onInstall,
}: {
  entry: ConnectorCatalogEntry | null;
  onClose: () => void;
  onInstall: (catalogEntryId: ConnectorCatalogEntry["id"], secretValue: string) => Promise<void>;
}) {
  const showToast = useToastStore((state) => state.show);
  const [secretValue, setSecretValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSecretValue("");
    setError(null);
  }, [entry?.id]);

  if (!entry) {
    return null;
  }
  const activeEntry = entry;
  const hasCredentialField = activeEntry.requiredFields.length > 0;
  const validationError = hasCredentialField ? validateConnectorSecretValue(secretValue) : null;

  async function handleSubmit() {
    if (hasCredentialField && validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onInstall(activeEntry.id, secretValue);
      showToast(`${activeEntry.name} connected.`, "info");
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : `Couldn't save ${activeEntry.name}. Try again.`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      open={!!entry}
      onClose={onClose}
      disableClose={submitting}
      title={`Connect ${activeEntry.name}`}
      description={activeEntry.oneLiner}
      footer={(
        <>
          <Button type="button" variant="ghost" size="md" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => { void handleSubmit(); }}
            loading={submitting}
            disabled={hasCredentialField && Boolean(validationError)}
          >
            {submitting ? "Connecting" : "Connect"}
          </Button>
        </>
      )}
    >
      {hasCredentialField ? (
        <ConnectorCredentialField
          entry={activeEntry}
          error={error}
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
        <ConnectorDetailsBlock entry={activeEntry} />
      )}
    </ModalShell>
  );
}
