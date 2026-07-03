import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { useOrganizationSwitchAction } from "@/hooks/organizations/workflows/use-organization-switch-action";
import type { OrganizationRecord } from "@/lib/domain/organizations/organization-records";
import { useToastStore } from "@/stores/toast/toast-store";

/**
 * Confirmation for the semi-destructive org->org switch: the desktop worker's
 * (user, org) identity rotates, so running local sessions are closed first.
 * Users with a single organization never reach this dialog — the switcher
 * only lists organizations they belong to, and clicking the already-active
 * one is a no-op. Org-less users gaining their first organization adopt it in
 * place without confirmation.
 */
export function OrganizationSwitchDialog({
  target,
  onClose,
}: {
  target: OrganizationRecord | null;
  onClose: () => void;
}) {
  const { switchOrganization, switchingOrganization } = useOrganizationSwitchAction();
  const showToast = useToastStore((state) => state.show);

  return (
    <ConfirmationDialog
      open={target !== null}
      title={target ? `Switch to ${target.name}?` : "Switch organization?"}
      description="Switching organizations closes your running local sessions."
      confirmLabel="Switch organization"
      loading={switchingOrganization}
      disableClose={switchingOrganization}
      onClose={onClose}
      onConfirm={() => {
        if (!target) {
          return;
        }
        // switchOrganization resets its own loading flag in a finally, but a
        // failed switch (e.g. worker teardown or the selection write throwing)
        // must not be swallowed: surface it and keep the dialog open so the
        // user can retry, instead of silently leaving the old org active.
        void switchOrganization(target.id).then(onClose, (error) => {
          showToast(
            error instanceof Error
              ? error.message
              : `Could not switch to ${target.name}.`,
          );
        });
      }}
    />
  );
}
