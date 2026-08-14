import { ConfirmationDialog } from "#product/primitives/patterns/ConfirmationDialog";

export interface AgentsPaneConfirmCopy {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
}

export function agentsPaneCloseConfirmCopy(title: string): AgentsPaneConfirmCopy {
  return {
    title: `Close “${title}”?`,
    body: "This immediately interrupts the current turn, discards queued prompts, and preserves the transcript. You can open this subagent again later.",
    confirmLabel: "Close",
    cancelLabel: "Cancel",
  };
}

export function agentsPanePromoteConfirmCopy(title: string): AgentsPaneConfirmCopy {
  return {
    title: `Promote “${title}”?`,
    body: "It becomes a top-level session in this workspace’s tabs, keeps its transcript, and can spawn its own subagents.",
    confirmLabel: "Promote",
    cancelLabel: "Cancel",
  };
}

interface AgentsPaneLifecycleDialogsProps {
  /** Display title of the child agent, interpolated into both dialogs. */
  agentTitle: string;
  closeConfirmOpen: boolean;
  closePending: boolean;
  onCancelClose: () => void;
  onConfirmClose: () => void;
  promoteConfirmOpen: boolean;
  promotePending: boolean;
  onCancelPromote: () => void;
  onConfirmPromote: () => void;
}

/**
 * The two Agents-pane lifecycle confirmations. Close confirmation appears only
 * for a Running child (Available closes immediately, without this dialog);
 * Promote confirmation appears for every non-Closed child.
 */
export function AgentsPaneLifecycleDialogs({
  agentTitle,
  closeConfirmOpen,
  closePending,
  onCancelClose,
  onConfirmClose,
  promoteConfirmOpen,
  promotePending,
  onCancelPromote,
  onConfirmPromote,
}: AgentsPaneLifecycleDialogsProps) {
  const closeCopy = agentsPaneCloseConfirmCopy(agentTitle);
  const promoteCopy = agentsPanePromoteConfirmCopy(agentTitle);
  return (
    <>
      <ConfirmationDialog
        open={closeConfirmOpen}
        title={closeCopy.title}
        description={closeCopy.body}
        confirmLabel={closeCopy.confirmLabel}
        cancelLabel={closeCopy.cancelLabel}
        confirmVariant="primary"
        loading={closePending}
        disableClose={closePending}
        onClose={onCancelClose}
        onConfirm={onConfirmClose}
      />
      <ConfirmationDialog
        open={promoteConfirmOpen}
        title={promoteCopy.title}
        description={promoteCopy.body}
        confirmLabel={promoteCopy.confirmLabel}
        cancelLabel={promoteCopy.cancelLabel}
        confirmVariant="primary"
        loading={promotePending}
        disableClose={promotePending}
        onClose={onCancelPromote}
        onConfirm={onConfirmPromote}
      />
    </>
  );
}
