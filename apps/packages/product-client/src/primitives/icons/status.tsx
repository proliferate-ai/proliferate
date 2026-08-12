import type { IconProps } from "./types";

export function CheckCircleFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} width="var(--icon-large)" height="var(--icon-large)" viewBox="0 0 20 21" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 2.9032C14.3713 2.9032 17.915 6.4469 17.915 10.8182C17.915 15.1896 14.3713 18.7333 10 18.7333C5.62867 18.7333 2.08496 15.1896 2.08496 10.8182C2.08496 6.4469 5.62867 2.9032 10 2.9032ZM8.89 13.4547L14.1191 8.22559C14.3788 7.96589 14.3788 7.54389 14.1191 7.28419C13.8594 7.02449 13.4374 7.02449 13.1777 7.28419L8.41943 12.0425L6.82227 10.4453C6.56257 10.1856 6.14057 10.1856 5.88087 10.4453C5.62117 10.705 5.62117 11.127 5.88087 11.3867L7.94873 13.4547C8.20843 13.7144 8.6303 13.7144 8.89 13.4547Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function Circle({ className, ...props }: IconProps) {
  return (
    <svg className={className} width="var(--icon-large)" height="var(--icon-large)" viewBox="0 0 20 21" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 2.9032C14.3713 2.9032 17.915 6.4469 17.915 10.8182C17.915 15.1896 14.3713 18.7333 10 18.7333C5.62867 18.7333 2.08496 15.1896 2.08496 10.8182C2.08496 6.4469 5.62867 2.9032 10 2.9032ZM10 4.23328C6.3632 4.23328 3.41504 7.18144 3.41504 10.8182C3.41504 14.455 6.3632 17.4032 10 17.4032C13.6368 17.4032 16.585 14.455 16.585 10.8182C16.585 7.18144 13.6368 4.23328 10 4.23328Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function CircleAlert({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}

export function ShieldCheckFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M11.67 2.08a1 1 0 0 1 .66 0l7 2.5A1 1 0 0 1 20 5.52V11c0 5.2-3.25 8.85-7.65 10.9a.82.82 0 0 1-.7 0C7.25 19.85 4 16.2 4 11V5.52a1 1 0 0 1 .67-.94l7-2.5Zm4.86 7.7a.75.75 0 0 0-1.06-1.06L10.75 13.44l-2.22-2.22a.75.75 0 1 0-1.06 1.06l2.75 2.75c.3.3.77.3 1.06 0l5.25-5.25Z" />
    </svg>
  );
}

/** Outline check-in-circle — lighter-weight than {@link CheckCircleFilled}, for inline confirmation states (goal met, plan comparison). */
export function CircleCheck({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function Lock({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/** Reuses the Shield body silhouette from product.tsx's `Shield`, swapped to an alert mark for the blocked/restricted state. */
export function ShieldAlert({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3 5 6v6c0 5 3.5 8 7 9 3.5-1 7-4 7-9V6l-7-3Z" />
      <path d="M12 8v4" />
      <path d="M12 15h.01" />
    </svg>
  );
}

export function AlertTriangle({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** Connectivity status glyph — offline banner. */
export function WifiOff({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 20h.01" />
      <path d="M8.5 16.429a5 5 0 0 1 7 0" />
      <path d="M5 12.859a10 10 0 0 1 5.17-2.69" />
      <path d="M19 12.859a10 10 0 0 0-2.007-1.523" />
      <path d="M2 8.82a15 15 0 0 1 4.177-2.643" />
      <path d="M22 8.82a15 15 0 0 0-11.288-3.764" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

/** Mirror of `core.tsx`'s `ChevronDown`. */
export function ChevronUp({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

/** Mirror of `core.tsx`'s `RotateCcw` — clockwise retry/refresh. */
export function RotateCw({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

export function Eye({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** {@link Eye} with the slash mark — hidden/revealed toggle companion. */
export function EyeOff({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 11 7 11 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 1 12s4 7 11 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

/** CSS-driven braille sweep retained for auth-only brand transitions. */
export function BrailleSweepBadge({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-jank-canary="braille"
      className={`braille-sweep-frame inline-block w-[1em] shrink-0 font-mono leading-none tracking-[-0.18em] ${className ?? ""}`}
    />
  );
}
