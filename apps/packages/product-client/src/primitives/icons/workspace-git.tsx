import type { IconProps } from "./types";

export function GitMerge({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  );
}

export function GitBranch({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

export function GitPullRequest({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M13 6h3a2 2 0 0 1 2 2v7" />
      <line x1="6" x2="6" y1="9" y2="21" />
    </svg>
  );
}

export function GitCommit({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M13.5013 10.0003C13.5013 8.06653 11.9341 6.49856 10.0003 6.49838C8.06641 6.49838 6.49837 8.06642 6.49837 10.0003C6.49855 11.9341 8.06652 13.5013 10.0003 13.5013C11.934 13.5011 13.5011 11.934 13.5013 10.0003ZM14.8314 10.0003C14.8312 12.6685 12.6685 14.8312 10.0003 14.8314C7.33198 14.8314 5.16847 12.6686 5.16829 10.0003C5.16829 7.33188 7.33187 5.1683 10.0003 5.1683C12.6686 5.16848 14.8314 7.33199 14.8314 10.0003Z" fill="currentColor" />
      <path d="M5 9.33497C5.36727 9.33497 5.66504 9.63274 5.66504 10C5.66504 10.3673 5.36727 10.665 5 10.665H1.25C0.882731 10.665 0.584961 10.3673 0.584961 10C0.584961 9.63274 0.882731 9.33497 1.25 9.33497H5Z" fill="currentColor" />
      <path d="M18.75 9.33497C19.1173 9.33497 19.415 9.63274 19.415 10C19.415 10.3673 19.1173 10.665 18.75 10.665H15C14.6327 10.665 14.335 10.3673 14.335 10C14.335 9.63274 14.6327 9.33497 15 9.33497H18.75Z" fill="currentColor" />
    </svg>
  );
}

export function Tree({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="M15.8 11.535c.367 0 .665.298.665.665v5a.665.665 0 0 1-.665.665h-5a.665.665 0 1 1 0-1.33h3.394l-3.565-3.564a.666.666 0 0 1 .942-.942l3.564 3.565V12.2c0-.367.298-.665.665-.665Zm0-9.4c.367 0 .665.298.665.665v5a.665.665 0 0 1-1.33 0V4.405l-5.128 5.128c-.323.324-.558.565-.842.74a2.668 2.668 0 0 1-.771.319c-.324.078-.662.073-1.12.073H1.93a.665.665 0 1 1 0-1.33h5.345c.52 0 .673-.005.809-.037.136-.033.266-.086.385-.16.12-.072.23-.177.598-.545l5.128-5.128H10.8a.665.665 0 0 1 0-1.33h5Z"
      />
    </svg>
  );
}

export function GitBranchIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="5.4165" cy="5" r="1.875" stroke="currentColor" strokeWidth="1.33" />
      <circle cx="5.4165" cy="15" r="1.875" stroke="currentColor" strokeWidth="1.33" />
      <circle cx="14.5833" cy="5" r="1.875" stroke="currentColor" strokeWidth="1.33" />
      <path d="M5.4165 6.66664V13.3333" stroke="currentColor" strokeWidth="1.33" strokeLinejoin="round" />
      <path d="M5.41658 12.5V11.6667C5.41658 10.7462 6.16278 10 7.08325 10H12.9166C13.8371 10 14.5833 9.25381 14.5833 8.33333V7.5" stroke="currentColor" strokeWidth="1.33" strokeLinejoin="round" />
    </svg>
  );
}

export type GitBranchStatusDotFill = "solid" | "hollow";

export interface GitBranchStatusIconProps extends IconProps {
  /**
   * Ink for the state dot only, as a `text-*` class — pass the PR kind's
   * tone through `statusDotToneTextClass` so the glyph and the dot-based
   * readings of the same state cannot drift apart. The dot resolves it via
   * its own `currentColor`, leaving the branch strokes on the consumer's ink.
   */
  dotClassName?: string;
  /** `hollow` is the outline used for states still in flight. */
  dotFill?: GitBranchStatusDotFill;
}

/**
 * PR-status identity glyph: `GitBranchIcon`'s branch column plus a hook
 * arrow, with a STANDALONE bottom-right state dot carrying the PR state.
 *
 * One SVG serves every state — never a per-state fork. Only two things vary:
 * whether the dot is filled or an outline (`dotFill`), and its ink
 * (`dotClassName`). Everything else is the consumer's `currentColor`.
 */
export function GitBranchStatusIcon({
  className,
  dotClassName,
  dotFill = "solid",
  ...props
}: GitBranchStatusIconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="5.4165" cy="5" r="1.875" stroke="currentColor" strokeWidth="1.33" />
      <circle cx="5.4165" cy="15" r="1.875" stroke="currentColor" strokeWidth="1.33" />
      <path d="M5.4165 6.66664V13.3333" stroke="currentColor" strokeWidth="1.33" strokeLinejoin="round" />
      <path d="M9.4 2.9L7.95 4.35L9.4 5.8" stroke="currentColor" strokeWidth="1.33" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.55 4.35H11.9C13.03 4.35 13.95 5.27 13.95 6.4V9.2" stroke="currentColor" strokeWidth="1.33" strokeLinecap="round" />
      <circle
        className={dotClassName}
        cx="15"
        cy="15"
        r="3"
        fill={dotFill === "hollow" ? "none" : "currentColor"}
        stroke="currentColor"
        strokeWidth="1.33"
      />
    </svg>
  );
}

/** Thread-row PR glyph: muted branch pipe + inbound arrow; the
 * status dot is part of the SVG and colored via --pr-status-dot-color
 * (rendered only when `dot` is set). */
export function PrBranchGlyph({ className, dot = false, ...props }: IconProps & { dot?: boolean }) {
  return (
    <svg className={className} width="var(--icon-paired)" height="var(--icon-paired)" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <g transform="translate(2.87695 2.45996)">
        <path d="M2.54004 0C3.94284 0 5.08008 1.13724 5.08008 2.54004C5.08008 3.71238 4.28484 4.69567 3.20508 4.98828V10.0908C4.28497 10.3833 5.08008 11.3676 5.08008 12.54C5.08008 13.9428 3.94284 15.0801 2.54004 15.0801C1.13724 15.0801 0 13.9428 0 12.54C0 11.3676 0.795113 10.3833 1.875 10.0908V4.98828C0.795239 4.69567 0 3.71238 0 2.54004C0 1.13724 1.13724 0 2.54004 0ZM2.54004 11.3301C1.87177 11.3301 1.33008 11.8718 1.33008 12.54C1.33008 13.2083 1.87177 13.75 2.54004 13.75C3.2083 13.75 3.75 13.2083 3.75 12.54C3.75 11.8718 3.2083 11.3301 2.54004 11.3301ZM2.54004 1.33008C1.87177 1.33008 1.33008 1.87177 1.33008 2.54004C1.33008 3.2083 1.87177 3.75 2.54004 3.75C3.2083 3.75 3.75 3.2083 3.75 2.54004C3.75 1.87177 3.2083 1.33008 2.54004 1.33008Z" fill="currentColor" />
        <path d="M8.42383 0.317383C8.68176 0.147236 9.03258 0.175585 9.25977 0.402344C9.51942 0.662002 9.51934 1.08404 9.25977 1.34375L8.72852 1.875H10.457C11.7446 1.87526 12.7891 2.91945 12.7891 4.20703V6.70703C12.7889 7.07387 12.4908 7.37163 12.124 7.37207C11.7569 7.37207 11.4592 7.07414 11.459 6.70703V4.20703C11.459 3.65399 11.01 3.20534 10.457 3.20508H8.72852L9.25977 3.73633L9.34473 3.84082C9.51509 4.09889 9.48688 4.44953 9.25977 4.67676C9.03252 4.90385 8.68189 4.93213 8.42383 4.76172L8.31934 4.67676L6.65234 3.00977C6.39315 2.75008 6.39296 2.3289 6.65234 2.06934L8.31934 0.402344L8.42383 0.317383Z" fill="currentColor" />
      </g>
      {dot ? (
        <circle cx="15.141" cy="15.141" r="3.141" fill="var(--pr-status-dot-color, currentColor)" />
      ) : null}
    </svg>
  );
}

/** Merged-PR glyph: merge topology, tinted at the callsite. */
export function PrMergedGlyph({ className, ...props }: IconProps) {
  return (
    <svg className={className} width="var(--icon-paired)" height="var(--icon-paired)" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <g transform="translate(2.87695 2.45996)">
        <path d="M3.75 12.54C3.75 11.8718 3.2083 11.3301 2.54004 11.3301C1.87177 11.3301 1.33008 11.8718 1.33008 12.54C1.33008 13.2083 1.87177 13.75 2.54004 13.75C3.2083 13.75 3.75 13.2083 3.75 12.54ZM12.917 10.04C12.917 9.37188 12.3751 8.83025 11.707 8.83008C11.0388 8.83008 10.4971 9.37177 10.4971 10.04C10.4971 10.7083 11.0388 11.25 11.707 11.25C12.3751 11.2498 12.917 10.7082 12.917 10.04ZM3.75 2.54004C3.75 1.87177 3.2083 1.33008 2.54004 1.33008C1.87177 1.33008 1.33008 1.87177 1.33008 2.54004C1.33008 3.2083 1.87177 3.75 2.54004 3.75C3.2083 3.75 3.75 3.2083 3.75 2.54004ZM5.08008 2.54004C5.08008 3.47934 4.56861 4.29686 3.81055 4.73633C4.22936 5.91905 4.89909 6.81802 5.75879 7.48242C6.72602 8.22983 7.9664 8.70627 9.42676 8.9248C9.83996 8.08166 10.7048 7.5 11.707 7.5C13.1097 7.50018 14.2471 8.63734 14.2471 10.04C14.2471 11.4427 13.1097 12.5799 11.707 12.5801C10.3687 12.5801 9.2737 11.5448 9.17578 10.2314C7.57006 9.98395 6.12118 9.44292 4.94629 8.53516C4.25331 7.99967 3.66805 7.34453 3.20508 6.56836V10.0908C4.28496 10.3833 5.08008 11.3676 5.08008 12.54C5.08008 13.9428 3.94284 15.0801 2.54004 15.0801C1.13724 15.0801 0 13.9428 0 12.54C0 11.3676 0.795119 10.3833 1.875 10.0908V4.98828C0.795245 4.69568 0 3.71239 0 2.54004C0 1.13724 1.13724 0 2.54004 0C3.94284 0 5.08008 1.13724 5.08008 2.54004Z" fill="currentColor" />
      </g>
    </svg>
  );
}
