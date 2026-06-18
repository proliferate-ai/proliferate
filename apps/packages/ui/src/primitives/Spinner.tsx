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
        className="size-full"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Faint full-ring track. */}
        <path
          opacity="0.3"
          d="M18 12C18 8.68629 15.3137 6 12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12ZM20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12C4 7.58172 7.58172 4 12 4C16.4183 4 20 7.58172 20 12Z"
          fill="currentColor"
        />
        {/* Solid ~270° arc over the track; the moving 90° gap reads as motion. */}
        <path
          d="M12 4C16.4183 4 20 7.58172 20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12H6C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6V4Z"
          fill="currentColor"
        />
      </svg>
    </div>
  );
}
