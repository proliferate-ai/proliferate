import { useState } from "react";
import { Button } from "#product/primitives/Button";
import { ConfirmationDialog } from "#product/primitives/patterns/ConfirmationDialog";
import { ChatComposerActions } from "#product/components/workspace/chat/input/ChatComposerActions";
import { ChatComposerControlRowFrame } from "#product/components/workspace/chat/composer/ChatComposerControlRowFrame";
import type { ComposerBlockedActionPresentation } from "#product/lib/domain/chat/composer/composer-blocked-state";

/**
 * The composer takeover's control row: the leading control cluster
 * (model/mode/goal/integrations) is dropped entirely, the trailing slot
 * carries the blocked state's recovery actions, and send stays disabled
 * (with the blocked message as its reason). Actions that declare a
 * confirmation (lost-workspace delete) route through a `ConfirmationDialog`
 * before their `onSelect` fires.
 */
export function ComposerBlockedControlRow({
  actions,
  disabledReason,
  isRunning,
  isEmpty,
  isEditingQueuedPrompt = false,
  onSubmit,
  onCancel,
}: {
  actions: ComposerBlockedActionPresentation[];
  disabledReason: string | null;
  isRunning: boolean;
  isEmpty: boolean;
  isEditingQueuedPrompt?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const [confirmingActionKey, setConfirmingActionKey] = useState<string | null>(null);
  const confirmingAction =
    actions.find((action) => action.key === confirmingActionKey && action.confirmation) ?? null;

  return (
    <>
      <ChatComposerControlRowFrame
        trailing={(
          <>
            {actions.map((action) => (
              <Button
                key={action.key}
                type="button"
                variant={action.variant === "primary" ? "primary" : "secondary"}
                size="sm"
                loading={action.loading}
                disabled={action.disabled}
                onClick={action.confirmation
                  ? () => setConfirmingActionKey(action.key)
                  : action.onSelect}
              >
                {action.label}
              </Button>
            ))}
          </>
        )}
        action={(
          <ChatComposerActions
            isRunning={isRunning}
            isEmpty={isEmpty}
            isDisabled
            disabledReason={disabledReason}
            isEditingQueuedPrompt={isEditingQueuedPrompt}
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        )}
      />
      {confirmingAction?.confirmation && (
        <ConfirmationDialog
          open
          title={confirmingAction.confirmation.title}
          description={confirmingAction.confirmation.description}
          confirmLabel={confirmingAction.confirmation.confirmLabel}
          confirmVariant="destructive"
          loading={confirmingAction.loading}
          disableClose={confirmingAction.loading}
          onClose={() => setConfirmingActionKey(null)}
          onConfirm={() => {
            setConfirmingActionKey(null);
            confirmingAction.onSelect();
          }}
        />
      )}
    </>
  );
}
