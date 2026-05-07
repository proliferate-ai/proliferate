import { Button } from "@/components/ui/Button";
import { ComposerAttachedPanel } from "./ComposerAttachedPanel";
import { useActivePendingApproval } from "@/hooks/chat/use-active-chat-session-selectors";
import { useChatPermissionActions } from "@/hooks/chat/use-chat-permission-actions";
import type { PermissionOptionAction } from "@/lib/domain/chat/composer/chat-input-helpers";

// Codex's approval header is just the title as medium-weight text — no
// icon, no label chip, no uppercase prefix. The title itself is
// self-describing (a command, a file path, or a question) so the extra
// chrome just added visual noise.

export interface ApprovalCardProps {
  title: string;
  actions: PermissionOptionAction[];
  onSelectOption: (optionId: string) => void;
  onAllow: () => void;
  onDeny: () => void;
}

/**
 * Pure presentational approval card. Takes all data as props so it can be
 * rendered in isolation (e.g. from the dev playground). Production callers
 * should use ConnectedApprovalCard which wires it to the harness store.
 */
export function ApprovalCard({
  title,
  actions,
  onSelectOption,
  onAllow,
  onDeny,
}: ApprovalCardProps) {
  const header = (
    <div className="text-chat min-w-0 truncate font-medium leading-[var(--text-chat--line-height)] text-foreground">
      {title}
    </div>
  );

  return (
    <ComposerAttachedPanel header={header}>
      <div className="flex flex-col gap-3 p-3">
        <ApprovalOptionsRow
          actions={actions}
          onSelectOption={onSelectOption}
          onAllow={onAllow}
          onDeny={onDeny}
        />
      </div>
    </ComposerAttachedPanel>
  );
}

export function ConnectedApprovalCard() {
  const { pendingApproval, pendingApprovalActions } = useActivePendingApproval();
  const {
    handleSelectPermissionOption,
    handleAllowPermission,
    handleDenyPermission,
  } = useChatPermissionActions();

  if (!pendingApproval) {
    return null;
  }

  return (
    <ApprovalCard
      title={pendingApproval.title}
      actions={pendingApprovalActions}
      onSelectOption={handleSelectPermissionOption}
      onAllow={handleAllowPermission}
      onDeny={handleDenyPermission}
    />
  );
}

const APPROVAL_BUTTON_CLASSNAME = "rounded-xl px-2.5 text-sm";

function ApprovalOptionsRow({
  actions,
  onSelectOption,
  onAllow,
  onDeny,
}: {
  actions: PermissionOptionAction[];
  onSelectOption: (optionId: string) => void;
  onAllow: () => void;
  onDeny: () => void;
}) {
  const hasExplicitActions = actions.length > 0;

  if (!hasExplicitActions) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={onDeny}
          variant="secondary"
          size="sm"
          className={APPROVAL_BUTTON_CLASSNAME}
        >
          Deny
        </Button>
        <Button
          type="button"
          onClick={onAllow}
          variant="primary"
          size="sm"
          className={APPROVAL_BUTTON_CLASSNAME}
        >
          Allow
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((action) => {
        const isAllow = action.kind?.startsWith("allow") ?? false;
        return (
          <Button
            key={action.optionId}
            type="button"
            onClick={() => onSelectOption(action.optionId)}
            variant={isAllow ? "primary" : "secondary"}
            size="sm"
            className={APPROVAL_BUTTON_CLASSNAME}
          >
            {action.label}
          </Button>
        );
      })}
    </div>
  );
}
