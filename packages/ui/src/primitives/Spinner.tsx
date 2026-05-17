export interface SpinnerProps {
  className?: string;
}

export function Spinner({ className }: SpinnerProps) {
  return (
    <div
      className={`proliferate-spinner inline-flex shrink-0 ${className ?? ""}`}
      data-loading-spinner
    >
      <svg
        aria-hidden="true"
        className="size-full overflow-visible"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle
          cx="10"
          cy="10"
          r="7.25"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="30 18"
          opacity="0.72"
        />
      </svg>
    </div>
  );
}
