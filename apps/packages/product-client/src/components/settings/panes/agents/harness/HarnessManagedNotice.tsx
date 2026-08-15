import type { AgentSummary } from "@anyharness/sdk";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";
import { Button } from "#product/primitives/Button";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import { useHarnessManagedNoticeDismissal } from "#product/hooks/agents/lifecycle/use-harness-managed-notice-dismissal";

/**
 * R2.0 (always-managed install): a managed copy now installs alongside a
 * harness the user already had on PATH, rather than being skipped. One-time,
 * dismissible per harness — `agent.userPathCopyDetected` is the additive
 * signal a PATH copy exists at all (see anyharness-contract's `AgentSummary`);
 * combined with `agent.agentProcess.source === "managed"` here, that is
 * exactly "both exist", which the resolved artifact alone cannot express
 * (a managed hit short-circuits before ever checking PATH).
 */
export function HarnessManagedNotice({
  harnessKind,
  displayName,
  agent,
}: {
  harnessKind: string;
  displayName: string;
  agent: AgentSummary | undefined;
}) {
  const { isDismissed, hydrated, dismiss } = useHarnessManagedNoticeDismissal(harnessKind);
  const hasManagedAndPathCopy = agent?.agentProcess?.source === "managed"
    && agent.userPathCopyDetected === true;

  if (!hydrated || isDismissed || !hasManagedAndPathCopy) {
    return null;
  }

  return (
    <NoticeBanner
      tone="info"
      title={HARNESS_PANE_COPY.managedNoticeTitle}
      action={(
        <Button variant="ghost" size="sm" onClick={dismiss}>
          {HARNESS_PANE_COPY.managedNoticeDismiss}
        </Button>
      )}
    >
      {HARNESS_PANE_COPY.managedNoticeDescription(displayName)}
    </NoticeBanner>
  );
}
