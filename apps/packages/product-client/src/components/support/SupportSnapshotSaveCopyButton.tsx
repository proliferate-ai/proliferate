import { Button } from "#product/primitives/Button";
import type {
  SupportSnapshotConsentState,
} from "#product/hooks/support/workflows/use-support-snapshot-consent";

interface SupportSnapshotSaveCopyButtonProps {
  snapshot: SupportSnapshotConsentState;
}

/**
 * **Save a copy…** beside Send. It is one of exactly two actions allowed to
 * start a preparation, so it is present only while snapshot consent is live —
 * never as a disabled affordance on a host that cannot prepare anything. It
 * writes the user-chosen ZIP and leaves the modal open.
 */
export function SupportSnapshotSaveCopyButton({
  snapshot,
}: SupportSnapshotSaveCopyButtonProps) {
  if (!snapshot.available || !snapshot.consent) {
    return null;
  }

  return (
    <Button
      type="button"
      variant="secondary"
      loading={snapshot.isPreparing}
      onClick={() => { void snapshot.saveCopy(); }}
    >
      Save a copy…
    </Button>
  );
}
