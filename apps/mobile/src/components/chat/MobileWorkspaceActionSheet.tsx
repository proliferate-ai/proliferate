import { useEffect, useState } from "react";
import type { CloudSessionProjection } from "@proliferate/cloud-sdk";
import type { CloudChatComposerControlView } from "@proliferate/product-domain/chats/cloud/composer-controls";

import { type MobileIconName } from "../primitives/MobileIcon";
import { MobilePopover } from "../primitives/popover/MobilePopover";
import { MobilePopoverDisclosure } from "../primitives/popover/MobilePopoverDisclosure";
import { MobilePopoverGroup } from "../primitives/popover/MobilePopoverGroup";
import { MobilePopoverOption } from "../primitives/popover/MobilePopoverOption";
import { MobilePopoverRow } from "../primitives/popover/MobilePopoverRow";

interface MobileWorkspaceActionSheetProps {
  visible: boolean;
  initialExpandedId?: string | null;
  branchLabel: string;
  unclaimed: boolean;
  claimPending: boolean;
  promptSubmitting: boolean;
  sessions: readonly CloudSessionProjection[];
  activeSessionId: string | null;
  newSessionMode: boolean;
  composerControls: readonly CloudChatComposerControlView[];
  onClaim: () => boolean | Promise<boolean>;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onCopyBranch: () => void;
  onClose: () => void;
}

export function MobileWorkspaceActionSheet({
  visible,
  initialExpandedId,
  branchLabel,
  unclaimed,
  claimPending,
  promptSubmitting,
  sessions,
  activeSessionId,
  newSessionMode,
  composerControls,
  onClaim,
  onNewSession,
  onSelectSession,
  onCopyBranch,
  onClose,
}: MobileWorkspaceActionSheetProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setExpandedId(visible ? initialExpandedId ?? null : null);
  }, [initialExpandedId, visible]);

  async function runClaim() {
    const claimed = await onClaim();
    if (claimed) {
      onClose();
    }
  }

  return (
    <MobilePopover visible={visible} onClose={onClose} anchor="top-right" insetTop={58} insetSide={8}>
      <MobilePopoverGroup expandedId={expandedId} onExpandedChange={setExpandedId}>
        {unclaimed ? (
          <MobilePopoverRow
            id="claim"
            icon="hand"
            title={claimPending ? "Claiming workspace" : "Claim workspace"}
            subtitle="Unlock replies and sessions."
            disabled={claimPending}
            onPress={() => {
              void runClaim();
            }}
          />
        ) : null}
        <MobilePopoverRow
          id="copy-branch"
          icon="copy"
          title="Copy branch"
          subtitle={branchLabel}
          onPress={() => {
            onCopyBranch();
            onClose();
          }}
        />
        {composerControls.map((control) => (
          <MobilePopoverDisclosure
            key={control.id}
            id={`control:${control.id}`}
            icon={controlIcon(control)}
            title={topLevelControlTitle(control)}
            value={controlValueLabel(control)}
            disabled={unclaimed || control.disabled}
          >
            {control.groups.flatMap((group) =>
              group.options.map((option) => (
                <MobilePopoverOption
                  key={`${group.id}:${option.id}`}
                  title={normalizeModelLabel(option.label)}
                  subtitle={option.description ?? undefined}
                  selected={Boolean(option.selected)}
                  disabled={option.disabled}
                  onSelect={() => {
                    control.onSelect?.(option.id);
                  }}
                />
              )),
            )}
          </MobilePopoverDisclosure>
        ))}
        <MobilePopoverDisclosure
          id="sessions"
          icon="sessions"
          title={`Sessions (${sessions.length})`}
          value={activeSessionLabel(sessions, activeSessionId, newSessionMode)}
          disabled={unclaimed}
        >
          <MobilePopoverOption
            title="New session"
            subtitle={
              promptSubmitting
                ? "Wait for the current prompt first."
                : sessions.length
                  ? `Start separately from ${formatSessionCount(sessions.length)}.`
                  : "Start the first chat here."
            }
            selected={newSessionMode}
            disabled={promptSubmitting}
            onSelect={() => {
              onNewSession();
              onClose();
            }}
          />
          {sessions.map((session, index) => {
            const selected = session.sessionId === activeSessionId && !newSessionMode;
            return (
              <MobilePopoverOption
                key={session.sessionId}
                title={sessionDisplayTitle(session, index)}
                subtitle={sessionDisplaySubtitle(session, selected)}
                selected={selected}
                onSelect={() => {
                  onSelectSession(session.sessionId);
                  onClose();
                }}
              />
            );
          })}
        </MobilePopoverDisclosure>
        {expandedId === "sessions" ? null : (
          <MobilePopoverRow
            id="new-session"
            icon="plus"
            title="New session"
            subtitle={promptSubmitting ? "Wait for this prompt first." : "Start a fresh session here."}
            disabled={unclaimed || promptSubmitting}
            onPress={() => {
              onNewSession();
              onClose();
            }}
          />
        )}
      </MobilePopoverGroup>
    </MobilePopover>
  );
}

function topLevelControlTitle(control: CloudChatComposerControlView): string {
  if (control.key === "model") {
    return "Model";
  }
  if (control.key === "mode") {
    return "Mode";
  }
  return control.label;
}

function controlValueLabel(control: CloudChatComposerControlView): string {
  const selected = selectedOptionLabel(control);
  const detail = control.detail;
  const value = detail && detail !== control.label && detail.toLowerCase() !== "mode"
    ? normalizeModelLabel(detail)
    : selected ?? "Choose";
  return control.pendingState ? `Updating ${value}` : value;
}

function selectedOptionLabel(control: CloudChatComposerControlView): string | null {
  for (const group of control.groups) {
    const selected = group.options.find((option) => option.selected);
    if (selected) {
      return normalizeModelLabel(selected.label);
    }
  }
  return null;
}

function activeSessionLabel(
  sessions: readonly CloudSessionProjection[],
  activeSessionId: string | null,
  newSessionMode: boolean,
): string {
  const countLabel = formatSessionCount(sessions.length);
  if (newSessionMode) {
    return sessions.length ? `New · ${countLabel}` : "New session";
  }
  if (!activeSessionId) {
    return sessions.length ? `Choose · ${countLabel}` : "No sessions";
  }
  const index = sessions.findIndex((session) => session.sessionId === activeSessionId);
  if (index === -1) {
    return activeSessionId.slice(0, 8);
  }
  return `${countLabel} · ${sessionDisplayTitle(sessions[index], index)}`;
}

function normalizeModelLabel(label: string): string {
  return label
    .replace(/^Claude\s*·\s*/i, "")
    .replace(/^Claude\s+(?=Sonnet|Haiku|Opus)/i, "")
    .replace(/^OpenAI\s*·\s*/i, "")
    .replace(/^Gemini\s*·\s*/i, "")
    .replace(/^Codex\s*·\s*/i, "");
}

function controlIcon(control: CloudChatComposerControlView): MobileIconName {
  switch (control.icon) {
    case "brain":
      return "brain";
    case "sparkles":
      return "sparkles";
    case "shieldCheck":
      return "shield";
    case "settings":
      return "settings";
    case "zap":
      return "sparkles";
    case "build":
    case "edit":
    case "opencodePlan":
    case "plan":
    case "read":
      return "settings";
    case "claude":
      return "claude";
    case "openai":
      return "openai";
    case "gemini":
      return "gemini";
    case "opencodeBuild":
    case "bot":
      return "sparkles";
    default:
      return "settings";
  }
}

function sessionDisplayTitle(session: CloudSessionProjection, index: number): string {
  const title = session.title?.trim();
  return title || `Session ${index + 1}`;
}

function sessionDisplaySubtitle(session: CloudSessionProjection, selected: boolean): string {
  const status = formatSessionStatus(session.status);
  return selected
    ? `Current · ${status} · ${session.sessionId.slice(0, 8)}`
    : `${status} · ${session.sessionId.slice(0, 8)}`;
}

function formatSessionCount(count: number): string {
  return count === 1 ? "1 session" : `${count} sessions`;
}

function formatSessionStatus(status: string): string {
  const normalized = status.replace(/_/g, " ").trim();
  return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : "Unknown";
}
