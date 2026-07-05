/**
 * The vertical connector drawn between step cards (Ona parity): a thin line with
 * a soft down-arrow head, left-aligned to the card's drag-handle spine.
 *
 * When `sessionBreak` is provided, the connector renders as a session-boundary
 * divider instead of the plain arrow — a labeled break indicating a new session
 * is opening on the next step.
 */

export interface WorkflowStepConnectorProps {
  /**
   * When set, renders a session-boundary break instead of the plain arrow.
   * The label is displayed inline (e.g. "new session · codex").
   */
  sessionBreak?: { label: string } | null;
}

export function WorkflowStepConnector({ sessionBreak }: WorkflowStepConnectorProps = {}) {
  if (sessionBreak) {
    return (
      <div className="flex items-center gap-2 py-1.5 pl-[7px]" aria-hidden>
        <div className="flex h-6 w-6 items-center justify-center">
          <svg width="14" height="24" viewBox="0 0 14 24" fill="none" className="text-border-heavy">
            <path d="M7 0V8" stroke="currentColor" strokeWidth="1.5" />
            <path d="M7 16V24" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </div>
        <span className="whitespace-nowrap rounded-full border border-border-heavy/50 px-2.5 py-0.5 font-mono text-[10px] leading-tight text-muted-foreground">
          {sessionBreak.label}
        </span>
      </div>
    );
  }

  return (
    <div className="flex justify-start pl-[13px]" aria-hidden>
      <svg
        width="14"
        height="26"
        viewBox="0 0 14 26"
        fill="none"
        className="text-border-heavy"
      >
        <path d="M7 0V22" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M2.5 17.5L7 22.5L11.5 17.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
