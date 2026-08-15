import { SegmentedControl } from "#product/primitives/SegmentedControl";
import { SupportCheckboxRow } from "#product/components/support/SupportCheckboxRow";
import type {
  SupportSnapshotConsentState,
} from "#product/hooks/support/workflows/use-support-snapshot-consent";
import {
  SUPPORT_SNAPSHOT_CONSENT_HELPER,
  SUPPORT_SNAPSHOT_CONSENT_LABEL,
  SUPPORT_SNAPSHOT_SCOPE_LABELS,
} from "#product/lib/domain/support/support-snapshot-consent";

interface SupportSnapshotConsentFieldProps {
  snapshot: SupportSnapshotConsentState;
}

/**
 * The per-report snapshot consent choice and its scope control.
 *
 * It renders nothing at all without the native support coordinator, so Web,
 * Mobile, and any Desktop build that cannot prepare a snapshot never show a
 * control that does nothing. The disclosure stays visible while the box is
 * unchecked; the scope control appears only after consent.
 */
export function SupportSnapshotConsentField({ snapshot }: SupportSnapshotConsentFieldProps) {
  if (!snapshot.available) {
    return null;
  }

  return (
    <div>
      <SupportCheckboxRow
        checked={snapshot.consent}
        onCheckedChange={snapshot.setConsent}
        label={SUPPORT_SNAPSHOT_CONSENT_LABEL}
        helper={SUPPORT_SNAPSHOT_CONSENT_HELPER}
        persistentHelper
      />
      {snapshot.consent ? (
        <div className="mt-2 pl-6">
          <SegmentedControl
            ariaLabel="Diagnostic snapshot scope"
            value={snapshot.scope}
            onChange={snapshot.setScope}
            items={[
              {
                id: "active_session" as const,
                label: SUPPORT_SNAPSHOT_SCOPE_LABELS.active_session,
                disabled: !snapshot.activeSessionAvailable,
              },
              {
                id: "recent_activity" as const,
                label: SUPPORT_SNAPSHOT_SCOPE_LABELS.recent_activity,
              },
            ]}
          />
        </div>
      ) : null}
      {snapshot.error ? (
        <p className="mt-1.5 pl-6 text-ui-sm text-destructive">{snapshot.error}</p>
      ) : null}
    </div>
  );
}
