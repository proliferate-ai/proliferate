import { useMemo } from "react";
import { ComposerAttachedPanel } from "./ComposerAttachedPanel";
import {
  ComposerOptionRow,
  useComposerOptionNumberKeys,
} from "./ComposerOptionRow";
import { useActivePendingApproval } from "@/hooks/chat/derived/use-active-pending-session-interactions";
import { useHeldInteractionPayload } from "@/hooks/chat/ui/use-composer-dock-card-presence";
import { useChatPermissionActions } from "@/hooks/chat/workflows/use-chat-permission-actions";
import type { PermissionOptionAction } from "@/lib/domain/chat/composer/chat-input-helpers";

// Codex's approval header is just the title as medium-weight text — no
// icon, no label chip, no uppercase prefix. The title itself is
// self-describing (a command, a file path, or a question) so the extra
// chrome just added visual noise. Header/type grammar comes from
// ComposerAttachedPanel (text-ui title, shared with the other cards).
//
// Options follow the codex popover-row anatomy (ComposerOptionRow): rounded
// hover rows without hairlines, leading number-key badges, 1–9 selects.
// Destructive options (deny/reject/cancel) render in --danger text.

export interface ApprovalCardProps {
  title: string;
  actions: PermissionOptionAction[];
  onSelectOption: (optionId: string) => void;
  onAllow: () => void;
  onDeny: () => void;
}

interface ApprovalOption {
  key: string;
  label: string;
  destructive: boolean;
  onSelect: () => void;
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
  const options = useMemo<ApprovalOption[]>(() => {
    if (actions.length > 0) {
      return actions.map((action) => ({
        key: action.optionId,
        label: action.label,
        destructive: isDestructiveActionKind(action.kind),
        onSelect: () => onSelectOption(action.optionId),
      }));
    }
    return [
      { key: "allow", label: "Allow", destructive: false, onSelect: onAllow },
      { key: "deny", label: "Deny", destructive: true, onSelect: onDeny },
    ];
  }, [actions, onAllow, onDeny, onSelectOption]);

  useComposerOptionNumberKeys(options.length, (index) => {
    options[index]?.onSelect();
  });

  return (
    <ComposerAttachedPanel title={title}>
      <div className="max-h-[300px] overflow-y-auto px-2 pb-2">
        {options.map((option, index) => (
          <ComposerOptionRow
            key={option.key}
            index={index}
            label={option.label}
            destructive={option.destructive}
            onSelect={option.onSelect}
          />
        ))}
      </div>
    </ComposerAttachedPanel>
  );
}

function isDestructiveActionKind(kind: string | null): boolean {
  if (!kind) return false;
  return kind.startsWith("reject") || kind.startsWith("deny") || kind.startsWith("cancel");
}

export function ConnectedApprovalCard() {
  const { pendingApproval, pendingApprovalActions } = useActivePendingApproval();
  // Hold the last payload so the card can still render while the dock slot
  // plays its 150ms exit fade after the permission resolves.
  const held = useHeldInteractionPayload(
    pendingApproval
      ? { approval: pendingApproval, actions: pendingApprovalActions }
      : null,
  );
  const {
    handleSelectPermissionOption,
    handleAllowPermission,
    handleDenyPermission,
  } = useChatPermissionActions();

  if (!held) {
    return null;
  }

  return (
    <ApprovalCard
      title={held.approval.title}
      actions={held.actions}
      onSelectOption={handleSelectPermissionOption}
      onAllow={handleAllowPermission}
      onDeny={handleDenyPermission}
    />
  );
}
