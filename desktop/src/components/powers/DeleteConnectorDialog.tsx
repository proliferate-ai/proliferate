import { useState } from "react";
import type { ConnectorCatalogEntry, InstalledConnectorRecord } from "@/lib/domain/mcp/types";
import { useToastStore } from "@/stores/toast/toast-store";
import { Button } from "@/components/ui/Button";
import { ModalShell } from "@/components/ui/ModalShell";

export function DeleteConnectorDialog({
  onClose,
  onDelete,
  open,
  record,
}: {
  onClose: () => void;
  onDelete: (connectionId: string, catalogEntryId: ConnectorCatalogEntry["id"]) => Promise<void>;
  open: boolean;
  record: InstalledConnectorRecord;
}) {
  const showToast = useToastStore((state) => state.show);
  const [submitting, setSubmitting] = useState(false);

  async function handleDelete() {
    setSubmitting(true);
    try {
      await onDelete(record.metadata.connectionId, record.catalogEntry.id);
      showToast(`${record.catalogEntry.name} deleted.`, "info");
      onClose();
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : `Couldn't delete ${record.catalogEntry.name}. Try again.`,
      );
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      disableClose={submitting}
      title={`Delete ${record.catalogEntry.name}?`}
      description={`Existing sessions that already use ${record.catalogEntry.name} will keep working as they do now. New sessions won't use it anymore.`}
      footer={(
        <>
          <Button type="button" variant="ghost" size="md" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="md"
            onClick={() => { void handleDelete(); }}
            loading={submitting}
          >
            Delete
          </Button>
        </>
      )}
    >
      <p className="text-sm text-muted-foreground">
        Deleting removes this connector from future sessions immediately.
      </p>
    </ModalShell>
  );
}
