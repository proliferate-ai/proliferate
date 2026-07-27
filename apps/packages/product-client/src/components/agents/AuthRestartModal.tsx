import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { ModalShell } from "@proliferate/ui/patterns/ModalShell";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";

export interface AuthRestartModalSession {
  sessionId: string;
  label: string;
}

interface AuthRestartModalProps {
  open: boolean;
  harnessKind: string;
  surface: AgentAuthSurface;
  sessions: AuthRestartModalSession[];
  onRestartNow: () => void;
  onDecline: () => void;
}

/**
 * The restart offer (agent-auth.md "Running sessions are offered a restart",
 * Proof C6): shown after the switched surface's runtime acknowledged the
 * applied auth state, listing exactly the running sessions of the switched
 * harness on the switched surface. "yes, restart now" relaunches them on the
 * new auth (transcript kept); "no" — and any other dismissal — does nothing:
 * no badge, no reminder, no persisted state.
 */
export function AuthRestartModal({
  open,
  harnessKind,
  surface,
  sessions,
  onRestartNow,
  onDecline,
}: AuthRestartModalProps) {
  return (
    <ModalShell
      open={open}
      onClose={onDecline}
      title={HARNESS_PANE_COPY.restartModalTitle}
      description={HARNESS_PANE_COPY.restartModalDescription}
      sizeClassName="max-w-[34rem]"
      footer={(
        <>
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="h-9 rounded-lg px-3 text-ui"
            data-auth-restart-decline
            onClick={onDecline}
          >
            {HARNESS_PANE_COPY.restartModalDecline}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            className="h-9 min-w-0 rounded-lg px-4 text-ui shadow-none"
            data-auth-restart-confirm
            onClick={onRestartNow}
          >
            {HARNESS_PANE_COPY.restartModalConfirm}
          </Button>
        </>
      )}
    >
      <ul
        className="flex max-h-64 flex-col gap-1 overflow-y-auto"
        data-auth-restart-modal={`${harnessKind}:${surface}`}
      >
        {sessions.map((session) => (
          <li
            key={session.sessionId}
            className="truncate rounded-md bg-foreground/5 px-3 py-2 text-ui-sm text-foreground"
            data-auth-restart-session={session.sessionId}
          >
            {session.label}
          </li>
        ))}
      </ul>
    </ModalShell>
  );
}
