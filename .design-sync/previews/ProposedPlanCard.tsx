import type { ReactNode } from "react";
import { ProposedPlanCard } from "@proliferate/ui";

const noop = () => {};

const PLAN = `Retune the desktop sidebar rows so workspace, thread and repo rows share one grid.

1. Move the PR status dot onto the leading git glyph (\`PrStatusIconOverlay\`) so the trailing cell is free for activity.
2. Give every row the same 30px box and 10px radius; subtitle rows go to 40px.
3. Fold the shortcut badge into the trailing cell behind \`shortcutRevealVisible\` instead of a second column.
4. Update \`ProductSidebarRepositories.test.tsx\` for the new leading-well width.

Files touched: \`apps/packages/product-ui/src/sidebar/*\`, \`apps/packages/product-client/src/components/workspace/shell/sidebar/*\`.`;

const SHORT_PLAN = `Prune stale worktrees on quit.

1. Walk \`~/.proliferate/worktrees\` and drop directories with no matching workspace record.
2. Guard the sweep behind a lock so two windows never prune at once.`;

/** The card sits in a chat transcript column, so it is width-bounded there too. */
function TranscriptColumn({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-2xl p-2">{children}</div>;
}

/** The decision state: Approve / Reject in the footer, warning chip in the header. */
export const AwaitingApproval = () => (
  <TranscriptColumn>
    <ProposedPlanCard
      title="Sidebar retune"
      content={PLAN}
      isStreaming={false}
      decisionState="pending"
      decisionVersion={3}
      onApprove={noop}
      onReject={noop}
    />
  </TranscriptColumn>
);

/** Approved, with the "Run here" continuation still offered. */
export const Approved = () => (
  <TranscriptColumn>
    <ProposedPlanCard
      title="Sidebar retune"
      content={SHORT_PLAN}
      isStreaming={false}
      decisionState="approved"
      decisionVersion={3}
      onImplementHere={noop}
      onHandOffToNewSession={noop}
    />
  </TranscriptColumn>
);

/** Still streaming out of ExitPlanMode: same shell, no chip and no footer. */
export const Streaming = () => (
  <TranscriptColumn>
    <ProposedPlanCard
      title="Plan"
      content={SHORT_PLAN}
      isStreaming
      decisionState="streaming"
    />
  </TranscriptColumn>
);

/** Native continuation failed: destructive chip plus the error note line. */
export const NativeContinuationFailed = () => (
  <TranscriptColumn>
    <ProposedPlanCard
      title="Sidebar retune"
      content={SHORT_PLAN}
      isStreaming={false}
      decisionState="approved"
      nativeResolutionState="failed"
      nativeContinuation
      decisionVersion={3}
      errorMessage="The harness closed before the approved plan could be linked to a session."
      onImplementHere={noop}
    />
  </TranscriptColumn>
);

/** Rejected and superseded are the two terminal, action-free states. */
export const RejectedAndSuperseded = () => (
  <div className="flex w-full max-w-2xl flex-col gap-3 p-2">
    <ProposedPlanCard
      title="Sidebar retune (v2)"
      content="Rework the trailing cell as a two-column grid so the time and the activity glyph can coexist."
      isStreaming={false}
      decisionState="rejected"
      decisionVersion={2}
    />
    <ProposedPlanCard
      title="Sidebar retune (v1)"
      content="Add a second row beneath each workspace for the branch name."
      isStreaming={false}
      decisionState="superseded"
      decisionVersion={1}
    />
  </div>
);
