/**
 * The vertical connector drawn between step cards (Ona parity): a thin line with
 * a soft down-arrow head, left-aligned to the card's drag-handle spine.
 */
export function WorkflowStepConnector() {
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
