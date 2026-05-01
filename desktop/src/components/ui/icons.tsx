import type { ComponentType, SVGProps } from "react";
import { useBrailleSweep } from "@/hooks/ui/use-braille-sweep";

export type IconProps = SVGProps<SVGSVGElement>;

export function ChevronRight({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function ChevronDown({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ChevronUpDown({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m7 15 5 5 5-5" />
      <path d="m7 9 5-5 5 5" />
    </svg>
  );
}

export function Minus({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 12h14" />
    </svg>
  );
}

export function Plus({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

export function MiniPlus({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="5" y1="1" x2="5" y2="9" />
      <line x1="1" y1="5" x2="9" y2="5" />
    </svg>
  );
}

export function X({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function Copy({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

export function Mail({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

export function Calendar({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 14h.01" />
      <path d="M12 14h.01" />
      <path d="M16 14h.01" />
      <path d="M8 18h.01" />
      <path d="M12 18h.01" />
    </svg>
  );
}

export function Search({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export type CommandPaletteGlyphName =
  | "arrow-left"
  | "arrow-right"
  | "chat"
  | "chat-plus"
  | "cloud-plus"
  | "command"
  | "folder-plus"
  | "git-branch"
  | "panel-bottom"
  | "pencil"
  | "play"
  | "rotate-ccw"
  | "search"
  | "settings"
  | "terminal";

export function CommandPaletteGlyph({
  name,
  className,
  ...props
}: IconProps & { name: CommandPaletteGlyphName }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {renderCommandPaletteGlyph(name)}
    </svg>
  );
}

function renderCommandPaletteGlyph(name: CommandPaletteGlyphName) {
  switch (name) {
    case "arrow-left":
      return (
        <>
          <path d="m12 19-7-7 7-7" />
          <path d="M19 12H5" />
        </>
      );
    case "arrow-right":
      return (
        <>
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </>
      );
    case "chat":
      return <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />;
    case "chat-plus":
      return (
        <>
          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
          <path d="M12 8v6" />
          <path d="M9 11h6" />
        </>
      );
    case "cloud-plus":
      return (
        <>
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 0 1 .5 8.97" />
          <path d="M18 14v6" />
          <path d="M15 17h6" />
        </>
      );
    case "command":
      return (
        <>
          <path d="M9 6v12" />
          <path d="M15 6v12" />
          <path d="M6 9h12" />
          <path d="M6 15h12" />
          <path d="M9 6a3 3 0 1 0-3 3" />
          <path d="M15 6a3 3 0 1 1 3 3" />
          <path d="M9 18a3 3 0 1 1-3-3" />
          <path d="M15 18a3 3 0 1 0 3-3" />
        </>
      );
    case "folder-plus":
      return (
        <>
          <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
          <path d="M12 10v6" />
          <path d="M9 13h6" />
        </>
      );
    case "git-branch":
      return (
        <>
          <path d="M6 3v12" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </>
      );
    case "panel-bottom":
      return (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 14h18" />
        </>
      );
    case "pencil":
      return (
        <>
          <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
          <path d="m15 5 4 4" />
        </>
      );
    case "play":
      return <path d="m6 3 15 9-15 9Z" />;
    case "rotate-ccw":
      return (
        <>
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v6h6" />
        </>
      );
    case "search":
      return (
        <>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </>
      );
    case "settings":
      return (
        <>
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </>
      );
    case "terminal":
      return (
        <>
          <path d="m4 17 6-6-6-6" />
          <path d="M12 19h8" />
        </>
      );
  }
}

export function Keyboard({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="M6 8h.01" />
      <path d="M10 8h.01" />
      <path d="M14 8h.01" />
      <path d="M18 8h.01" />
      <path d="M8 12h.01" />
      <path d="M12 12h.01" />
      <path d="M16 12h.01" />
      <path d="M7 16h10" />
    </svg>
  );
}

export function Pencil({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

export function Trash({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

export function Archive({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect width="20" height="5" x="2" y="3" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </svg>
  );
}

export function GitMerge({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  );
}

export function ClipboardList({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 11h4" />
      <path d="M12 16h4" />
      <path d="M8 11h.01" />
      <path d="M8 16h.01" />
    </svg>
  );
}

export function CheckCircleFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} width="20" height="21" viewBox="0 0 20 21" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
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
    <svg className={className} width="20" height="21" viewBox="0 0 20 21" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 2.9032C14.3713 2.9032 17.915 6.4469 17.915 10.8182C17.915 15.1896 14.3713 18.7333 10 18.7333C5.62867 18.7333 2.08496 15.1896 2.08496 10.8182C2.08496 6.4469 5.62867 2.9032 10 2.9032ZM10 4.23328C6.3632 4.23328 3.41504 7.18144 3.41504 10.8182C3.41504 14.455 6.3632 17.4032 10 17.4032C13.6368 17.4032 16.585 14.455 16.585 10.8182C16.585 7.18144 13.6368 4.23328 10 4.23328Z"
        fill="currentColor"
      />
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

export function Terminal({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

export function FileText({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 13H8" />
      <path d="M16 17H8" />
      <path d="M16 13h-2" />
    </svg>
  );
}

export function FileIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

export function FilePen({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 22h6a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v10" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10.4 12.6a2 2 0 1 1 3 3L8 21l-4 1 1-4Z" />
    </svg>
  );
}

export function FilePlus({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M9 15h6" />
      <path d="M12 18v-6" />
    </svg>
  );
}

export function Clock({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function Settings({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function FolderPlus({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      <line x1="12" x2="12" y1="10" y2="16" />
      <line x1="9" x2="15" y1="13" y2="13" />
    </svg>
  );
}

export function FolderList({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l1.7 2H18.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
      <path d="M8 11.5h8" />
      <path d="M8 15h6" />
    </svg>
  );
}

export function CircleQuestion({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function ReadModeFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M6.5 3C5.12 3 4 4.12 4 5.5v13C4 19.88 5.12 21 6.5 21h5.76a6.48 6.48 0 0 1-1.16-2H6.5a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5h7.09L18 9.41v1.33a6.44 6.44 0 0 1 2 .57V9a1 1 0 0 0-.29-.71l-5-5A1 1 0 0 0 14 3H6.5Z" />
      <path d="M13 4.5V9a1 1 0 0 0 1 1h4.5L13 4.5Z" />
      <path d="M8 10.25A.75.75 0 0 1 8.75 9h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 8 10.25Z" />
      <path d="M8.75 12.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M17.25 12.5a4.75 4.75 0 0 0-3.62 7.83l-1.1 1.1a.75.75 0 1 0 1.06 1.06l1.1-1.1a4.75 4.75 0 1 0 2.56-8.89Zm0 1.5a3.25 3.25 0 1 0 0 6.5a3.25 3.25 0 0 0 0-6.5Z" />
    </svg>
  );
}

export function EditModeFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M5.5 3A2.5 2.5 0 0 0 3 5.5v13A2.5 2.5 0 0 0 5.5 21h8.37a2.5 2.5 0 0 0 1.77-.73l4.63-4.63a2.5 2.5 0 0 0 .73-1.77V5.5A2.5 2.5 0 0 0 18.5 3h-13Zm3.25 5h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5Zm0 3.5h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1 0-1.5Z" />
      <path d="M17.44 11.66a1.5 1.5 0 0 1 2.12 2.12l-4.8 4.8a2 2 0 0 1-.86.5l-2.03.58a.75.75 0 0 1-.93-.93l.58-2.03a2 2 0 0 1 .5-.86l5.42-5.42Z" />
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

export function MessageSquareFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M5.5 4A3.5 3.5 0 0 0 2 7.5v7A3.5 3.5 0 0 0 5.5 18H6v2.25a.75.75 0 0 0 1.2.6L11 18h7.5a3.5 3.5 0 0 0 3.5-3.5v-7A3.5 3.5 0 0 0 18.5 4h-13Z" />
    </svg>
  );
}

export function AddMessage({ className, ...props }: IconProps) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {...props}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2.07 5.008C2 5.376 2 5.818 2 6.7v7.05c0 3.771 0 5.657 1.172 6.828C4.343 21.75 6.229 21.75 10 21.75h4c3.771 0 5.657 0 6.828-1.172C22 19.407 22 17.521 22 13.75v-2.202c0-2.632 0-3.949-.77-4.804a2.984 2.984 0 0 0-.224-.225c-.855-.769-2.172-.769-4.804-.769h-.374c-1.153 0-1.73 0-2.268-.153a4 4 0 0 1-.848-.352c-.488-.271-.896-.68-1.712-1.495l-.55-.55c-.274-.274-.41-.41-.554-.53a4 4 0 0 0-2.18-.903c-.186-.017-.38-.017-.766-.017c-.883 0-1.324 0-1.692.07A4 4 0 0 0 2.07 5.007ZM12 11a.75.75 0 0 1 .75.75V13H14a.75.75 0 0 1 0 1.5h-1.25v1.25a.75.75 0 0 1-1.5 0V14.5H10a.75.75 0 0 1 0-1.5h1.25v-1.25A.75.75 0 0 1 12 11Z"
      />
    </svg>
  );
}

export function AddPlan({ className, ...props }: IconProps) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {...props}>
      <g fill="currentColor">
        <path d="M9.5 2A1.5 1.5 0 0 0 8 3.5v1A1.5 1.5 0 0 0 9.5 6h5A1.5 1.5 0 0 0 16 4.5v-1A1.5 1.5 0 0 0 14.5 2h-5Z" />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M3.879 4.877c.569-.57 1.363-.77 2.621-.84V4.5a3 3 0 0 0 3 3h5a3 3 0 0 0 3-3v-.463c1.258.07 2.052.27 2.621.84C21 5.756 21 7.17 21 9.998v6c0 2.829 0 4.243-.879 5.122c-.878.878-2.293.878-5.121.878H9c-2.828 0-4.243 0-5.121-.878C3 20.24 3 18.827 3 15.998v-6c0-2.828 0-4.242.879-5.121ZM12.75 11a.75.75 0 0 0-1.5 0v2.25H9a.75.75 0 0 0 0 1.5h2.25V17a.75.75 0 0 0 1.5 0v-2.25H15a.75.75 0 0 0 0-1.5h-2.25V11Z"
        />
      </g>
    </svg>
  );
}

export function SplitPanel({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.944 2.25c-1.838 0-3.294 0-4.433.153c-1.172.158-2.121.49-2.87 1.238c-.748.749-1.08 1.698-1.238 2.87c-.153 1.14-.153 2.595-.153 4.433v2.112c0 1.838 0 3.294.153 4.433c.158 1.172.49 2.121 1.238 2.87c.749.748 1.698 1.08 2.87 1.238c1.14.153 2.595.153 4.433.153h5.022a.768.768 0 0 0 .072-.001c1.384-.004 2.523-.027 3.451-.152c1.172-.158 2.121-.49 2.87-1.238c.748-.749 1.08-1.698 1.238-2.87c.153-1.14.153-2.595.153-4.433v-2.112c0-1.838 0-3.294-.153-4.433c-.158-1.172-.49-2.121-1.238-2.87c-.749-.748-1.698-1.08-2.87-1.238c-.928-.125-2.067-.148-3.45-.152a.763.763 0 0 0-.073 0l-.91-.001H9.944Zm4.306 1.5H10c-1.907 0-3.261.002-4.29.14c-1.005.135-1.585.389-2.008.812c-.423.423-.677 1.003-.812 2.009c-.138 1.028-.14 2.382-.14 4.289v2c0 1.907.002 3.262.14 4.29c.135 1.005.389 1.585.812 2.008c.423.423 1.003.677 2.009.812c1.028.138 2.382.14 4.289.14h4.25V3.75Zm1.5 16.494c1.034-.01 1.858-.042 2.54-.134c1.005-.135 1.585-.389 2.008-.812c.423-.423.677-1.003.812-2.009c.138-1.027.14-2.382.14-4.289v-2c0-1.907-.002-3.261-.14-4.29c-.135-1.005-.389-1.585-.812-2.008c-.423-.423-1.003-.677-2.009-.812c-.68-.092-1.505-.123-2.539-.134v16.488Z"
      />
    </svg>
  );
}

export function SplitPanelRight({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="1" y="2" width="14" height="12" rx="2" />
      <line x1="10.5" y1="2" x2="10.5" y2="14" />
    </svg>
  );
}

export function ArrowLeft({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

export function ArrowRight({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function ArrowUp({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </svg>
  );
}

export function ListFilter({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 6h18" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
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

export function LoaderCircle({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 12a9 9 0 1 1-6.22-8.56" />
    </svg>
  );
}

export function StopSquare({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  );
}

export function Play({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M8 5.4c0-.8.9-1.3 1.6-.9l9.2 6.1c.6.4.6 1.4 0 1.8l-9.2 6.1A1 1 0 0 1 8 17.6V5.4Z" />
    </svg>
  );
}

export function Pause({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M7 5.5A1.5 1.5 0 0 1 8.5 4h1A1.5 1.5 0 0 1 11 5.5v13A1.5 1.5 0 0 1 9.5 20h-1A1.5 1.5 0 0 1 7 18.5v-13Z" />
      <path d="M13 5.5A1.5 1.5 0 0 1 14.5 4h1A1.5 1.5 0 0 1 17 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-1a1.5 1.5 0 0 1-1.5-1.5v-13Z" />
    </svg>
  );
}

export function ArrowUpRight({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </svg>
  );
}

export function ExternalLink({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" x2="21" y1="14" y2="3" />
    </svg>
  );
}

export function Check({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function XLines({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function Fork({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M16 3h5v5" />
      <path d="M8 3H3v5" />
      <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" />
      <path d="m15 9 6-6" />
    </svg>
  );
}

export function Undo({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  );
}

export function Brain({ className, ...props }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 28 28"
      fill="none"
      {...props}
    >
      <path
        fill="currentColor"
        d="M10.875 2c.895 0 1.719.304 2.375.814V25.01a4.18 4.18 0 0 1-2.706.99a4.206 4.206 0 0 1-4.112-3.325l-.04-.19a4.748 4.748 0 0 1-1.736-8.999a4.5 4.5 0 0 1 2.36-7.96A3.874 3.874 0 0 1 10.876 2m6.25 0a3.874 3.874 0 0 1 3.858 3.526a4.5 4.5 0 0 1 2.36 7.96a4.75 4.75 0 0 1-1.735 8.998l-.04.19A4.206 4.206 0 0 1 17.456 26a4.18 4.18 0 0 1-2.706-.99V2.814A3.86 3.86 0 0 1 17.125 2"
      />
    </svg>
  );
}

export function BrainOutline({ className, ...props }: IconProps) {
  return (
    <svg
      className={className}

      xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 24 24"
      {...props}>
      <path fill="currentColor" d="M19.864 8.465a3.505 3.505 0 0 0-3.03-4.449A3.005 3.005 0 0 0 14 2a2.98 2.98 0 0 0-2 .78A2.98 2.98 0 0 0 10 2c-1.301 0-2.41.831-2.825 2.015a3.505 3.505 0 0 0-3.039 4.45A4.028 4.028 0 0 0 2 12c0 1.075.428 2.086 1.172 2.832A4.067 4.067 0 0 0 3 16c0 1.957 1.412 3.59 3.306 3.934A3.515 3.515 0 0 0 9.5 22c.979 0 1.864-.407 2.5-1.059A3.484 3.484 0 0 0 14.5 22a3.51 3.51 0 0 0 3.19-2.06a4.006 4.006 0 0 0 3.138-5.108A4.003 4.003 0 0 0 22 12a4.028 4.028 0 0 0-2.136-3.535zM9.5 20c-.711 0-1.33-.504-1.47-1.198L7.818 18H7c-1.103 0-2-.897-2-2c0-.352.085-.682.253-.981l.456-.816l-.784-.51A2.019 2.019 0 0 1 4 12c0-.977.723-1.824 1.682-1.972l1.693-.26l-1.059-1.346a1.502 1.502 0 0 1 1.498-2.39L9 6.207V5a1 1 0 0 1 2 0v13.5c0 .827-.673 1.5-1.5 1.5zm9.575-6.308l-.784.51l.456.816c.168.3.253.63.253.982c0 1.103-.897 2-2.05 2h-.818l-.162.802A1.502 1.502 0 0 1 14.5 20c-.827 0-1.5-.673-1.5-1.5V5c0-.552.448-1 1-1s1 .448 1 1.05v1.207l1.186-.225a1.502 1.502 0 0 1 1.498 2.39l-1.059 1.347l1.693.26A2.002 2.002 0 0 1 20 12c0 .683-.346 1.315-.925 1.692z" />
    </svg>
  )
}

export function PlanningIcon({ className, ...props }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <g fill="none" fillRule="evenodd">
        <path d="m12.594 23.258l-.012.002l-.071.035l-.02.004l-.014-.004l-.071-.036q-.016-.004-.024.006l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.016-.018m.264-.113l-.014.002l-.184.093l-.01.01l-.003.011l.018.43l.005.012l.008.008l.201.092q.019.005.029-.008l.004-.014l-.034-.614q-.005-.019-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.003-.011l.018-.43l-.003-.012l-.01-.01z" />
        <path
          fill="currentColor"
          d="M18.35 2c.781 0 1.557.47 1.825 1.305l.076.246l.079.28l.08.316l.077.346l.073.376l.034.198l.061.417c.23 1.79.157 4.23-1.122 6.705l-.159.297c-1.342 2.415-1.245 4.846-.942 6.425l.074.349l.038.162l.077.3l.077.262c.274.89-.318 1.922-1.327 2.01l-.14.006H5.65c-.78 0-1.557-.47-1.825-1.305l-.075-.246l-.08-.28l-.08-.316l-.077-.346l-.073-.376q-.036-.195-.066-.403l-.055-.43l-.042-.454c-.127-1.704.065-3.855 1.19-6.033l.159-.297C5.968 9.1 5.87 6.668 5.568 5.09l-.073-.349l-.039-.162l-.077-.3l-.077-.262c-.274-.89.318-1.922 1.327-2.01L6.77 2zM12 12H9a1 1 0 1 0 0 2h3a1 1 0 1 0 0-2m4-4h-6a1 1 0 0 0-.117 1.993L10 10h6a1 1 0 0 0 .117-1.993z"
        />
      </g>
    </svg>
  );
}

export function Shield({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3 5 6v6c0 5 3.5 8 7 9 3.5-1 7-4 7-9V6l-7-3Z" />
      <path d="M9.5 12.5 11 14l3.5-3.5" />
    </svg>
  );
}

export function MessageSquare({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function StickyNote({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2 2h12v9l-5 5H2V2Z" />
      <path d="M9 11v5" />
      <path d="M9 11h5" />
    </svg>
  );
}

export function Link2({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <line x1="8" x2="16" y1="12" y2="12" />
    </svg>
  );
}

export function GitHub({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.338c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
    </svg>
  );
}

export function Globe({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

export function Sun({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

export function Moon({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

export function Monitor({ className, ...props }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Z" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </svg>
  );
}

export function Folder({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

export function FolderOpen({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/** Filled folder-plus icon matching Codex's "Add new project" button */
export function FolderPlusFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 20 20" {...props}>
      <path d="M15.2041 17.5V15.665H13.3691C13.0019 15.665 12.7041 15.3673 12.7041 15C12.7041 14.6327 13.0019 14.335 13.3691 14.335H15.2041V12.5C15.2041 12.1327 15.5019 11.835 15.8691 11.835C16.2362 11.8352 16.5332 12.1329 16.5332 12.5V14.335H18.3691C18.7362 14.3352 19.0332 14.6329 19.0332 15C19.0332 15.3671 18.7362 15.6648 18.3691 15.665H16.5332V17.5C16.5332 17.8671 16.2362 18.1648 15.8691 18.165C15.5019 18.165 15.2041 17.8673 15.2041 17.5ZM2.12012 12.7002V7.29981C2.12012 6.64581 2.11922 6.1149 2.1543 5.68555C2.19002 5.24867 2.26619 4.85832 2.45117 4.49512L2.56836 4.28516C2.86045 3.80898 3.27979 3.42103 3.78028 3.16602L3.91797 3.10156C4.24192 2.96268 4.5885 2.90039 4.97071 2.86914C5.40006 2.83406 5.93096 2.83496 6.58496 2.83496H7.28028C7.42346 2.83496 7.52305 2.83479 7.6211 2.84082L7.875 2.86719C8.46133 2.95309 9.01189 3.20874 9.45703 3.60547L9.70215 3.84473C9.81425 3.95779 9.85105 3.99455 9.88672 4.02637L9.99805 4.11719C10.2646 4.31741 10.5851 4.43638 10.9199 4.45703L11.1797 4.45996H13.6914C14.2499 4.45996 14.703 4.45958 15.0713 4.48535C15.4458 4.51157 15.7828 4.56683 16.1025 4.70313L16.3662 4.83106C16.9638 5.15706 17.4378 5.67623 17.707 6.30762L17.7939 6.54981C17.868 6.79538 17.904 7.05317 17.9238 7.33203C17.9498 7.69789 17.9502 8.14747 17.9502 8.7002C17.9501 8.87631 17.8803 9.0453 17.7559 9.16992C17.6311 9.29464 17.4615 9.36524 17.2852 9.36524H3.4502V12.7002C3.4502 13.3761 3.45084 13.8434 3.48047 14.2061C3.50947 14.5608 3.56304 14.7568 3.63672 14.9014L3.70215 15.0195C3.86642 15.2873 4.10236 15.505 4.38379 15.6484L4.50391 15.7002C4.63661 15.7476 4.81329 15.783 5.0791 15.8047C5.44174 15.8343 5.90903 15.835 6.58496 15.835H9.40918L9.54395 15.8486C9.84681 15.9108 10.0742 16.1788 10.0742 16.5C10.0742 16.8212 9.84681 17.0892 9.54395 17.1514L9.40918 17.165H6.58496C5.93096 17.165 5.40006 17.1659 4.97071 17.1309C4.5885 17.0996 4.24192 17.0373 3.91797 16.8984L3.78028 16.834C3.27979 16.579 2.86045 16.191 2.56836 15.7148L2.45117 15.5049C2.26619 15.1417 2.19002 14.7513 2.1543 14.3145C2.11922 13.8851 2.12012 13.3542 2.12012 12.7002ZM3.4502 8.03516H16.6172C16.6146 7.79548 16.6098 7.59777 16.5977 7.42676C16.5816 7.20054 16.5552 7.04845 16.5205 6.9336L16.4834 6.8291C16.332 6.47411 16.0655 6.1824 15.7295 5.99903L15.5811 5.92676C15.4545 5.8728 15.2835 5.83385 14.9785 5.8125C14.6674 5.79073 14.2686 5.79004 13.6914 5.79004H11.1797L10.8379 5.78418C10.2426 5.74746 9.67313 5.53663 9.19922 5.18067L9.00196 5.01953C8.92848 4.95403 8.85889 4.88222 8.75781 4.78028L8.57227 4.59863C8.32169 4.37525 8.01175 4.23086 7.68164 4.18262L7.54004 4.16797C7.49225 4.16502 7.43987 4.16504 7.28028 4.16504H6.58496C5.90903 4.16504 5.44174 4.16569 5.0791 4.19531C4.81329 4.21705 4.63661 4.25237 4.50391 4.29981L4.38379 4.35156C4.10236 4.49499 3.86642 4.71271 3.70215 4.98047L3.63672 5.09863C3.56304 5.24324 3.50947 5.43924 3.48047 5.79395C3.45084 6.15659 3.4502 6.62388 3.4502 7.29981V8.03516Z" />
    </svg>
  );
}

/** Filled folder icon matching Codex's sidebar project folders */
export function FolderFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 20 20" {...props}>
      <path d="M6.584 2.874a3.01 3.01 0 0 1 1.816.757c.073.064.142.135.243.237.112.113.15.15.187.183.292.26.663.415 1.053.44.049.002.102.002.261.002h2.718c.56 0 1.015 0 1.386.027.377.027.714.086 1.034.226.608.267 1.11.727 1.43 1.31.168.307.256.637.316 1.01.03.181.054.383.077.609h.371a1.915 1.915 0 0 1 1.832 2.475l-1.645 5.367a2.331 2.331 0 0 1-2.229 1.648H4.754c-.61 0-1.15-.23-1.559-.6a3.006 3.006 0 0 1-.847-.933c-.191-.33-.287-.687-.351-1.093-.063-.398-.1-.89-.147-1.499l-.418-5.435c-.052-.683-.096-1.235-.093-1.681.002-.453.05-.858.214-1.237a3.008 3.008 0 0 1 1.365-1.475c.366-.192.766-.27 1.218-.308.444-.036.997-.036 1.682-.036h.427c.144 0 .242 0 .339.006Zm-.66 6.13a.586.586 0 0 0-.559.415l-1.57 5.121a1.002 1.002 0 0 0 .589 1.224c.109.03.244.055.422.071h10.628c.44 0 .828-.288.957-.708l1.645-5.366a.585.585 0 0 0-.56-.756H5.925Zm-.106-4.872c-.706 0-1.198 0-1.579.032-.374.03-.582.087-.734.167a1.744 1.744 0 0 0-.791.855c-.068.157-.11.369-.112.745-.002.382.036.873.09 1.578l.374 4.87 1.028-3.35a1.916 1.916 0 0 1 1.83-1.354h9.909a8.189 8.189 0 0 0-.052-.406c-.05-.304-.107-.476-.178-.606a1.746 1.746 0 0 0-.829-.76c-.135-.059-.312-.1-.618-.123a19.667 19.667 0 0 0-1.294-.023h-2.718c-.143 0-.243 0-.34-.006a3.007 3.007 0 0 1-1.815-.757 6.091 6.091 0 0 1-.243-.237 4.418 4.418 0 0 0-.187-.183 1.745 1.745 0 0 0-1.052-.44c-.05-.002-.103-.002-.262-.002h-.427Z" />
    </svg>
  );
}

/** Filter/funnel icon matching Codex's sidebar filter button */
export function Filter({ className, ...props }: IconProps) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 20 20" {...props}>
      <path d="M12.5 14.0049C12.8673 14.0049 13.165 14.3027 13.165 14.6699C13.165 15.0372 12.8673 15.335 12.5 15.335H7.5C7.13273 15.335 6.83496 15.0372 6.83496 14.6699C6.83496 14.3027 7.13273 14.0049 7.5 14.0049H12.5Z" />
      <path d="M15 9.33496C15.3673 9.33496 15.665 9.63273 15.665 10C15.665 10.3673 15.3673 10.665 15 10.665H5C4.63273 10.665 4.33496 10.3673 4.33496 10C4.33496 9.63273 4.63273 9.33496 5 9.33496H15Z" />
      <path d="M17.5 4.66504C17.8673 4.66504 18.165 4.96281 18.165 5.33008C18.165 5.69735 17.8673 5.99512 17.5 5.99512H2.5C2.13273 5.99512 1.83496 5.69735 1.83496 5.33008C1.83496 4.96281 2.13273 4.66504 2.5 4.66504H17.5Z" />
    </svg>
  );
}

/** Collapse-all icon matching Codex's sidebar collapse button */
export function CollapseAll({ className, ...props }: IconProps) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 20 20" {...props}>
      <path d="M16.0299 3.0293C16.2896 2.76996 16.7107 2.76988 16.9703 3.0293C17.23 3.28899 17.23 3.711 16.9703 3.9707L13.2731 7.66797H16.9996L17.1344 7.68164C17.4372 7.74375 17.6645 8.01192 17.6647 8.33301C17.6647 8.65421 17.4372 8.92219 17.1344 8.98438L16.9996 8.99805H11.6666C11.2994 8.99801 11.0016 8.70026 11.0016 8.33301V3C11.0016 2.63275 11.2994 2.33499 11.6666 2.33496C12.0339 2.33496 12.3317 2.63273 12.3317 3V6.72754L16.0299 3.0293ZM8.99475 17C8.99475 17.3673 8.69698 17.665 8.32971 17.665C7.96258 17.6649 7.66467 17.3672 7.66467 17V13.2725L3.96741 16.9707C3.70771 17.2304 3.2857 17.2304 3.026 16.9707C2.7663 16.711 2.7663 16.289 3.026 16.0293L6.72424 12.332H2.9967C2.62955 12.332 2.33185 12.0341 2.33167 11.667C2.33167 11.2997 2.62943 11.002 2.9967 11.002H8.32971C8.69698 11.002 8.99475 11.2997 8.99475 11.667V17Z" />
    </svg>
  );
}

export function Home({ className, ...props }: IconProps) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

export function Grid({ className, ...props }: IconProps) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" {...props}>
      <path d="M7.94562 14.0277C7.94556 12.9376 7.0621 12.054 5.97198 12.054C4.88197 12.0542 3.99841 12.9377 3.99835 14.0277C3.99835 15.1178 4.88194 16.0012 5.97198 16.0013C7.06213 16.0013 7.94562 15.1178 7.94562 14.0277ZM16.0013 14.0277C16.0012 12.9376 15.1178 12.054 14.0276 12.054C12.9376 12.0541 12.0541 12.9376 12.054 14.0277C12.054 15.1178 12.9376 16.0013 14.0276 16.0013C15.1178 16.0013 16.0013 15.1178 16.0013 14.0277ZM7.94562 5.97202C7.9455 4.88197 7.06206 3.99838 5.97198 3.99838C4.88201 3.9985 3.99847 4.88204 3.99835 5.97202C3.99835 7.06209 4.88194 7.94553 5.97198 7.94565C7.06213 7.94565 7.94562 7.06216 7.94562 5.97202ZM16.0013 5.97202C16.0012 4.88197 15.1177 3.99838 14.0276 3.99838C12.9376 3.99844 12.0541 4.882 12.054 5.97202C12.054 7.06213 12.9375 7.94559 14.0276 7.94565C15.1178 7.94565 16.0013 7.06216 16.0013 5.97202ZM9.2757 14.0277C9.2757 15.8524 7.79667 17.3314 5.97198 17.3314C4.1474 17.3313 2.66827 15.8523 2.66827 14.0277C2.66833 12.2031 4.14743 10.7241 5.97198 10.724C7.79664 10.724 9.27564 12.203 9.2757 14.0277ZM17.3314 14.0277C17.3314 15.8524 15.8523 17.3314 14.0276 17.3314C12.203 17.3313 10.7239 15.8523 10.7239 14.0277C10.724 12.2031 12.203 10.724 14.0276 10.724C15.8523 10.724 17.3313 12.203 17.3314 14.0277ZM9.2757 5.97202C9.2757 7.7967 7.79667 9.27573 5.97198 9.27573C4.1474 9.27561 2.66827 7.79663 2.66827 5.97202C2.66839 4.1475 4.14747 2.66842 5.97198 2.6683C7.7966 2.6683 9.27558 4.14743 9.2757 5.97202ZM17.3314 5.97202C17.3314 7.7967 15.8523 9.27573 14.0276 9.27573C12.203 9.27567 10.7239 7.79667 10.7239 5.97202C10.7241 4.14746 12.2031 2.66836 14.0276 2.6683C15.8523 2.6683 17.3312 4.14743 17.3314 5.97202Z" />
    </svg>
  );
}

/** Expand-all icon — inverse of CollapseAll: arrows point outward from center. */
export function ExpandAll({ className, ...props }: IconProps) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 24 24" {...props}>
      <path
        fillRule="evenodd"
        d="M3 3.75C3 3.336 3.336 3 3.75 3H9a.75.75 0 0 1 0 1.5H5.56l3.97 3.97a.75.75 0 1 1-1.06 1.06L4.5 5.56V9a.75.75 0 0 1-1.5 0V3.75Zm12 0A.75.75 0 0 1 15.75 3H21a.75.75 0 0 1 .75.75V9a.75.75 0 0 1-1.5 0V5.56l-3.97 3.97a.75.75 0 1 1-1.06-1.06l3.97-3.97H15.75A.75.75 0 0 1 15 3.75ZM9.53 15.47a.75.75 0 0 1 0 1.06l-3.97 3.97H9A.75.75 0 0 1 9 22.0H3.75A.75.75 0 0 1 3 21.25V16a.75.75 0 0 1 1.5 0v3.44l3.97-3.97a.75.75 0 0 1 1.06 0Zm4.94 0a.75.75 0 0 1 1.06 0l3.97 3.97V16a.75.75 0 0 1 1.5 0v5.25a.75.75 0 0 1-.75.75h-5.25a.75.75 0 0 1 0-1.5h3.44l-3.97-3.97a.75.75 0 0 1 0-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** Spinning ring indicator — 3/4 arc that rotates. */
export function Spinner({ className }: { className?: string }) {
  return (
    <div className={`inline-flex animate-spin ${className ?? ""}`} style={{ animationDuration: "2s" }}>
      <svg className="size-full" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle
          cx="10"
          cy="10"
          r="7.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="28 19"
        />
      </svg>
    </div>
  );
}

/**
 * Animated braille-sweep badge — the diagonal-fill loading vocabulary used
 * across the app (transcript indicator, chat tab badges, sidebar workspace
 * rows). Driven by the shared useBrailleSweep ticker so every instance
 * animates in lockstep. Pass `className` for size and color.
 */
export function BrailleSweepBadge({ className }: { className?: string }) {
  const frame = useBrailleSweep();
  return (
    <span
      className={`inline-block w-[1em] shrink-0 font-mono leading-none tracking-[-0.18em] ${className ?? ""}`}
    >
      {frame}
    </span>
  );
}

export function Zap({ className, ...props }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M19.745 10.5a1.41 1.41 0 0 1-.26.66l-7.94 10.73a.94.94 0 0 1-.53.35a.827.827 0 0 1-.22 0a1.099 1.099 0 0 1-.4-.08a1 1 0 0 1-.55-1l.8-6.21h-5.13a1.41 1.41 0 0 1-.7-.22a1.33 1.33 0 0 1-.46-.56a1.45 1.45 0 0 1-.1-.69c.03-.236.12-.46.26-.65l7.94-10.71a.93.93 0 0 1 .51-.34a1 1 0 0 1 .63.06a.94.94 0 0 1 .44.42a1 1 0 0 1 .11.55l-.8 6.21h5.14a1.16 1.16 0 0 1 .7.22c.194.141.35.33.45.55c.096.223.134.467.11.71" />
    </svg>
  );
}

export function MoreHorizontal({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}

export function SendIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 12h13" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function Sparkles({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
    </svg>
  );
}

export function ClaudeSparkle({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2L13.09 8.26L18 6L15.74 10.91L22 12L15.74 13.09L18 18L13.09 15.74L12 22L10.91 15.74L6 18L8.26 13.09L2 12L8.26 10.91L6 6L10.91 8.26L12 2Z" />
    </svg>
  );
}

type ProliferateNode = { x: number; y: number; size: number };

const PROLIFERATE_VIEW_BOX = "300 300 200 200";
const PROLIFERATE_CENTER_NODE: ProliferateNode = { x: 375, y: 375, size: 50 };
const PROLIFERATE_CENTER_NODE_SMALL: ProliferateNode = { x: 387, y: 387, size: 26 };
const PROLIFERATE_INNER_NODES: ProliferateNode[] = [
  { x: 392, y: 350.67, size: 16 },  // top
  { x: 433.33, y: 392, size: 16 },  // right
  { x: 392, y: 433.33, size: 16 },  // bottom
  { x: 350.67, y: 392, size: 16 },  // left
];
const PROLIFERATE_ORBIT_NODES = [
  { x: 387.67, y: 305, size: 24.67 },
  { x: 429, y: 346.33, size: 24.67 },
  { x: 470.33, y: 387.67, size: 24.67 },
  { x: 429, y: 429, size: 24.67 },
  { x: 387.67, y: 470.33, size: 24.67 },
  { x: 346.33, y: 429, size: 24.67 },
  { x: 305, y: 387.67, size: 24.67 },
  { x: 346.33, y: 346.33, size: 24.67 },
];
const PROLIFERATE_ORBIT_DELAY_CLASSES = [
  "[animation-delay:0s]",
  "[animation-delay:0.2s]",
  "[animation-delay:0.4s]",
  "[animation-delay:0.6s]",
  "[animation-delay:0.8s]",
  "[animation-delay:1s]",
  "[animation-delay:1.2s]",
  "[animation-delay:1.4s]",
] as const;

function renderProliferateNode(node: ProliferateNode, key: string, className?: string) {
  return (
    <rect
      key={key}
      x={node.x}
      y={node.y}
      width={node.size}
      height={node.size}
      fill="currentColor"
      className={className}
    />
  );
}

function ProliferateMark({
  className,
  nodes,
  ...props
}: IconProps & {
  nodes: ProliferateNode[];
}) {
  return (
    <svg
      className={className}
      viewBox={PROLIFERATE_VIEW_BOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="crispEdges"
      {...props}
    >
      {nodes.map((node, index) => renderProliferateNode(node, `node-${index}`))}
    </svg>
  );
}



/** Proliferate icon — Full mark */
export function ProliferateIcon({ className, ...props }: IconProps) {
  return (
    <ProliferateMark
      className={className}
      nodes={[PROLIFERATE_CENTER_NODE, ...PROLIFERATE_ORBIT_NODES]}
      {...props}
    />
  );
}



/**
 * Proliferate loading mark — uses the shared braille sweep so the loading
 * vocabulary stays consistent across the app. Sized via `className` with a
 * `text-Xl` token (the braille is a glyph, not an SVG).
 */
export function ProliferateIconLoading({ className }: { className?: string }) {
  return <BrailleSweepBadge className={className} />;
}

/**
 * Proliferate icon — one-shot resolve animation.
 *
 * Orbit nodes fade in first, clockwise from top, and the center node
 * lands last as the punctuation. Each node holds lit once shown
 * (forwards fill mode on the keyframe). Used as the "loaded → brand
 * resolves" beat after the braille loading sweep lands in ChatReadyHero.
 */
export function ProliferateIconResolve({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox={PROLIFERATE_VIEW_BOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="crispEdges"
    >
      {PROLIFERATE_ORBIT_NODES.map((node, i) =>
        renderProliferateNode(node, `resolve-o${i}`, `animate-resolve-${i}`)
      )}
      {renderProliferateNode(PROLIFERATE_CENTER_NODE, "resolve-c", "animate-resolve-8")}
    </svg>
  );
}

/**
 * Snake — one orbit node fades in per time step, stays lit for a few steps,
 * then fades out. ~3 nodes visible at any moment, sliding around the orbit.
 * Center stays at a steady low opacity as an anchor.
 */
/**
 * Renders all 13 snake nodes (8 outer + 4 inner + center) with a given
 * step order. `order` maps each step index to { layer, nodeIndex }.
 */
type SnakeStep = { layer: "outer" | "inner" | "center"; idx: number };

function ProliferateSnakeMark({
  className,
  snakePath,
}: { className?: string; snakePath: SnakeStep[] }) {
  // Build a map from (layer+idx) → animation step
  const stepMap = new Map<string, number>();
  snakePath.forEach((entry, step) => stepMap.set(`${entry.layer}-${entry.idx}`, step));

  const cls = (layer: string, idx: number) =>
    `animate-snake-${stepMap.get(`${layer}-${idx}`) ?? 0}`;

  return (
    <svg
      className={className}
      viewBox={PROLIFERATE_VIEW_BOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="crispEdges"
    >
      {PROLIFERATE_ORBIT_NODES.map((node, i) =>
        renderProliferateNode(node, `snake-o${i}`, cls("outer", i))
      )}
      {PROLIFERATE_INNER_NODES.map((node, i) =>
        renderProliferateNode(node, `snake-i${i}`, cls("inner", i))
      )}
      {renderProliferateNode(PROLIFERATE_CENTER_NODE_SMALL, "snake-c", cls("center", 0))}
    </svg>
  );
}

// Path A — Spiral inward: outer CW → inner CW → center
const SNAKE_PATH_SPIRAL_IN = [
  { layer: "outer" as const, idx: 0 }, { layer: "outer" as const, idx: 1 },
  { layer: "outer" as const, idx: 2 }, { layer: "outer" as const, idx: 3 },
  { layer: "outer" as const, idx: 4 }, { layer: "outer" as const, idx: 5 },
  { layer: "outer" as const, idx: 6 }, { layer: "outer" as const, idx: 7 },
  { layer: "inner" as const, idx: 0 }, { layer: "inner" as const, idx: 1 },
  { layer: "inner" as const, idx: 2 }, { layer: "inner" as const, idx: 3 },
  { layer: "center" as const, idx: 0 },
];

// Path B — Spiral outward: center → inner CW → outer CW
const SNAKE_PATH_SPIRAL_OUT = [
  { layer: "center" as const, idx: 0 },
  { layer: "inner" as const, idx: 0 }, { layer: "inner" as const, idx: 1 },
  { layer: "inner" as const, idx: 2 }, { layer: "inner" as const, idx: 3 },
  { layer: "outer" as const, idx: 0 }, { layer: "outer" as const, idx: 1 },
  { layer: "outer" as const, idx: 2 }, { layer: "outer" as const, idx: 3 },
  { layer: "outer" as const, idx: 4 }, { layer: "outer" as const, idx: 5 },
  { layer: "outer" as const, idx: 6 }, { layer: "outer" as const, idx: 7 },
];

// Path C — Radial spokes: each cardinal outer+inner pair, then diagonals, then center
// top(o0,i0) → right(o2,i1) → bottom(o4,i2) → left(o6,i3) → diagonals → center
const SNAKE_PATH_SPOKES = [
  { layer: "outer" as const, idx: 0 }, { layer: "inner" as const, idx: 0 },
  { layer: "outer" as const, idx: 2 }, { layer: "inner" as const, idx: 1 },
  { layer: "outer" as const, idx: 4 }, { layer: "inner" as const, idx: 2 },
  { layer: "outer" as const, idx: 6 }, { layer: "inner" as const, idx: 3 },
  { layer: "outer" as const, idx: 1 }, { layer: "outer" as const, idx: 3 },
  { layer: "outer" as const, idx: 5 }, { layer: "outer" as const, idx: 7 },
  { layer: "center" as const, idx: 0 },
];

// Path D — Bounce: opposite outer pairs, then opposite inner, then center
const SNAKE_PATH_BOUNCE = [
  { layer: "outer" as const, idx: 0 }, { layer: "outer" as const, idx: 4 },
  { layer: "outer" as const, idx: 2 }, { layer: "outer" as const, idx: 6 },
  { layer: "outer" as const, idx: 1 }, { layer: "outer" as const, idx: 5 },
  { layer: "outer" as const, idx: 3 }, { layer: "outer" as const, idx: 7 },
  { layer: "inner" as const, idx: 0 }, { layer: "inner" as const, idx: 2 },
  { layer: "inner" as const, idx: 1 }, { layer: "inner" as const, idx: 3 },
  { layer: "center" as const, idx: 0 },
];

/** A — Spiral inward */
export function ProliferateIconSnakeSpiralIn(props: IconProps) {
  return <ProliferateSnakeMark {...props} snakePath={SNAKE_PATH_SPIRAL_IN} />;
}
/** B — Spiral outward */
export function ProliferateIconSnakeSpiralOut(props: IconProps) {
  return <ProliferateSnakeMark {...props} snakePath={SNAKE_PATH_SPIRAL_OUT} />;
}
/** C — Radial spokes */
export function ProliferateIconSnakeSpokes(props: IconProps) {
  return <ProliferateSnakeMark {...props} snakePath={SNAKE_PATH_SPOKES} />;
}
/** D — Bounce (opposites) */
export function ProliferateIconSnakeBounce(props: IconProps) {
  return <ProliferateSnakeMark {...props} snakePath={SNAKE_PATH_BOUNCE} />;
}

/** @deprecated use named snake variants */
export const ProliferateIconAssemble = ProliferateIconSnakeSpiralIn;

export function GitCommit({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M13.5013 10.0003C13.5013 8.06653 11.9341 6.49856 10.0003 6.49838C8.06641 6.49838 6.49837 8.06642 6.49837 10.0003C6.49855 11.9341 8.06652 13.5013 10.0003 13.5013C11.934 13.5011 13.5011 11.934 13.5013 10.0003ZM14.8314 10.0003C14.8312 12.6685 12.6685 14.8312 10.0003 14.8314C7.33198 14.8314 5.16847 12.6686 5.16829 10.0003C5.16829 7.33188 7.33187 5.1683 10.0003 5.1683C12.6686 5.16848 14.8314 7.33199 14.8314 10.0003Z" fill="currentColor" />
      <path d="M5 9.33497C5.36727 9.33497 5.66504 9.63274 5.66504 10C5.66504 10.3673 5.36727 10.665 5 10.665H1.25C0.882731 10.665 0.584961 10.3673 0.584961 10C0.584961 9.63274 0.882731 9.33497 1.25 9.33497H5Z" fill="currentColor" />
      <path d="M18.75 9.33497C19.1173 9.33497 19.415 9.63274 19.415 10C19.415 10.3673 19.1173 10.665 18.75 10.665H15C14.6327 10.665 14.335 10.3673 14.335 10C14.335 9.63274 14.6327 9.33497 15 9.33497H18.75Z" fill="currentColor" />
    </svg>
  );
}

export function CloudUpload({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M15.0001 14.9967C16.841 14.9967 18.3334 13.5044 18.3334 11.6634C18.3334 9.82246 16.841 8.33008 15.0001 8.33008C15.0001 5.56865 12.7615 3.33008 10.0001 3.33008C7.80904 3.33008 5.94715 4.73939 5.27148 6.70098C3.23605 6.97537 1.66675 8.71946 1.66675 10.8301C1.66675 12.8458 3.09817 14.5273 5 14.9134" stroke="currentColor" strokeWidth="1.33" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 12.5L10 10L12.5 12.5" stroke="currentColor" strokeWidth="1.33" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 10.5V17" stroke="currentColor" strokeWidth="1.33" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Blocks({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" {...props}>
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3" />
    </svg>
  );
}

export function CircleUser({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="10" r="3" />
      <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
    </svg>
  );
}

export function CloudIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </svg>
  );
}

export function Tree({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M12 2 L6 11 L9 11 L4 18 L20 18 L15 11 L18 11 Z" />
      <path d="M12 18 L12 22" />
    </svg>
  );
}

export function RefreshCw({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
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

export const BlockIcon = ProliferateIcon;

export function RippleLogo({ className, ...props }: IconProps) {
  return (
    <svg
      className={className}
      viewBox={PROLIFERATE_VIEW_BOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="crispEdges"
      {...props}
    >
      {renderProliferateNode(
        PROLIFERATE_CENTER_NODE,
        "center",
        "animate-ripple-center",
      )}
      {PROLIFERATE_ORBIT_NODES.map((node, index) =>
        renderProliferateNode(
          node,
          `orbit-${index}`,
          `animate-ripple-sat ${PROLIFERATE_ORBIT_DELAY_CLASSES[index]}`,
        ),
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Provider icons — monochrome SVGs that inherit currentColor.
// ---------------------------------------------------------------------------

function ClaudeProviderIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} fill="currentColor" fillRule="evenodd" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" />
    </svg>
  );
}

function OpenAIProviderIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} fill="currentColor" fillRule="evenodd" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" />
    </svg>
  );
}

function CursorProviderIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} fill="currentColor" fillRule="evenodd" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z" />
    </svg>
  );
}

function GeminiProviderIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} fill="currentColor" fillRule="evenodd" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" />
    </svg>
  );
}

function GrokProviderIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} fill="currentColor" fillRule="evenodd" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815" />
    </svg>
  );
}

function AmpProviderIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} fill="currentColor" fillRule="evenodd" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M15.087 23.18L12.03 24l-2.097-7.823-5.738 5.738-2.251-2.251 5.718-5.719-7.769-2.082.82-3.057 11.294 3.08 3.08 11.295z" />
      <path d="M19.505 18.762l-3.057.82-2.564-9.573-9.572-2.564.819-3.057 11.295 3.079 3.08 11.295z" />
      <path d="M23.893 14.374l-3.057.82-2.565-9.572L8.7 3.057 9.52 0l11.295 3.08 3.079 11.294z" />
    </svg>
  );
}

function OpencodeProviderIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} fill="currentColor" fillRule="evenodd" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M16 6H8v12h8V6zm4 16H4V2h16v20z" />
    </svg>
  );
}

const PROVIDER_ICON_MAP: Record<string, ComponentType<IconProps>> = {
  claude: ClaudeProviderIcon,
  codex: OpenAIProviderIcon,
  openai: OpenAIProviderIcon,
  cursor: CursorProviderIcon,
  gemini: GeminiProviderIcon,
  grok: GrokProviderIcon,
  opencode: OpencodeProviderIcon,
  amp: AmpProviderIcon,
};

export const APP_ICON_ASSETS: Record<string, string> = {
  finder: "/app-icons/finder.png",
  cursor: "/app-icons/cursor.png",
  vscode: "/app-icons/vscode.png",
  windsurf: "/app-icons/windsurf.png",
  zed: "/app-icons/zed.png",
  terminal: "/app-icons/terminal.webp",
  ghostty: "/app-icons/ghostty.png",
};

export function ProviderIcon({
  kind,
  className = "size-4",
}: {
  kind: string;
  className?: string;
}) {
  const Icon = PROVIDER_ICON_MAP[kind];
  if (!Icon) return null;
  return <Icon className={className} />;
}

export function AgentGlyph({
  agentKind,
  color,
  className = "size-4",
}: {
  agentKind?: string | null;
  color?: string | null;
  className?: string;
}) {
  const Icon = agentKind ? PROVIDER_ICON_MAP[agentKind] : undefined;
  const style = color ? { color } : undefined;
  if (Icon) {
    return (
      <span className="inline-flex" style={style}>
        <Icon className={className} />
      </span>
    );
  }
  return (
    <span className="inline-flex" style={style}>
      <ProliferateIcon className={className} />
    </span>
  );
}

export function FinderIcon({ className }: IconProps) {
  return <AppIcon id="finder" className={className} />;
}

export function CursorIcon({ className }: IconProps) {
  return <AppIcon id="cursor" className={className} />;
}

export function TerminalAppIcon({ className }: IconProps) {
  return <AppIcon id="terminal" className={className} />;
}

export function VSCodeIcon({ className }: IconProps) {
  return <AppIcon id="vscode" className={className} />;
}

export function WindsurfIcon({ className }: IconProps) {
  return <AppIcon id="windsurf" className={className} />;
}

export function ZedIcon({ className }: IconProps) {
  return <AppIcon id="zed" className={className} />;
}

export function SublimeIcon({ className }: IconProps) {
  return <AppIcon id="sublime" className={className} />;
}

export function OpenAIIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} {...props} width="721" height="721" viewBox="0 0 721 721" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g clip-path="url(#clip0_1637_2934)">
        <g clip-path="url(#clip1_1637_2934)">
          <path d="M304.246 294.611V249.028C304.246 245.189 305.687 242.309 309.044 240.392L400.692 187.612C413.167 180.415 428.042 177.058 443.394 177.058C500.971 177.058 537.44 221.682 537.44 269.182C537.44 272.54 537.44 276.379 536.959 280.218L441.954 224.558C436.197 221.201 430.437 221.201 424.68 224.558L304.246 294.611ZM518.245 472.145V363.224C518.245 356.505 515.364 351.707 509.608 348.349L389.174 278.296L428.519 255.743C431.877 253.826 434.757 253.826 438.115 255.743L529.762 308.523C556.154 323.879 573.905 356.505 573.905 388.171C573.905 424.636 552.315 458.225 518.245 472.141V472.145ZM275.937 376.182L236.592 353.152C233.235 351.235 231.794 348.354 231.794 344.515V238.956C231.794 187.617 271.139 148.749 324.4 148.749C344.555 148.749 363.264 155.468 379.102 167.463L284.578 222.164C278.822 225.521 275.942 230.319 275.942 237.039V376.186L275.937 376.182ZM360.626 425.122L304.246 393.455V326.283L360.626 294.616L417.002 326.283V393.455L360.626 425.122ZM396.852 570.989C376.698 570.989 357.989 564.27 342.151 552.276L436.674 497.574C442.431 494.217 445.311 489.419 445.311 482.699V343.552L485.138 366.582C488.495 368.499 489.936 371.379 489.936 375.219V480.778C489.936 532.117 450.109 570.985 396.852 570.985V570.989ZM283.134 463.99L191.486 411.211C165.094 395.854 147.343 363.229 147.343 331.562C147.343 294.616 169.415 261.509 203.48 247.593V356.991C203.48 363.71 206.361 368.508 212.117 371.866L332.074 441.437L292.729 463.99C289.372 465.907 286.491 465.907 283.134 463.99ZM277.859 542.68C223.639 542.68 183.813 501.895 183.813 451.514C183.813 447.675 184.294 443.836 184.771 439.997L279.295 494.698C285.051 498.056 290.812 498.056 296.568 494.698L417.002 425.127V470.71C417.002 474.549 415.562 477.429 412.204 479.346L320.557 532.126C308.081 539.323 293.206 542.68 277.854 542.68H277.859ZM396.852 599.776C454.911 599.776 503.37 558.513 514.41 503.812C568.149 489.896 602.696 439.515 602.696 388.176C602.696 354.587 588.303 321.962 562.392 298.45C564.791 288.373 566.231 278.296 566.231 268.224C566.231 199.611 510.571 148.267 446.274 148.267C433.322 148.267 420.846 150.184 408.37 154.505C386.775 133.392 357.026 119.958 324.4 119.958C266.342 119.958 217.883 161.22 206.843 215.921C153.104 229.837 118.557 280.218 118.557 331.557C118.557 365.146 132.95 397.771 158.861 421.283C156.462 431.36 155.022 441.437 155.022 451.51C155.022 520.123 210.682 571.466 274.978 571.466C287.931 571.466 300.407 569.549 312.883 565.228C334.473 586.341 364.222 599.776 396.852 599.776Z" fill="black" />
        </g>
      </g>
      <defs>
        <clipPath id="clip0_1637_2934">
          <rect width="720" height="720" fill="white" transform="translate(0.606934 0.0999756)" />
        </clipPath>
        <clipPath id="clip1_1637_2934">
          <rect width="484.139" height="479.818" fill="white" transform="translate(118.557 119.958)" />
        </clipPath>
      </defs>
    </svg>
  )
}

export function GmailBrandIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="52 42 88 66" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path fill="#4285F4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
      <path fill="#34A853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
      <path fill="#FBBC04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
      <path fill="#EA4335" d="M72 74V48l24 18 24-18v26L96 92" />
      <path fill="#C5221F" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2" />
    </svg>
  );
}

export function OutlookBrandIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 1831.085 1703.335" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path fill="#0A2767" d="M1831.083 894.25c.1-14.318-7.298-27.644-19.503-35.131h-.213l-.767-.426-634.492-375.585a84.16 84.16 0 0 0-8.517-5.067c-24.498-12.639-53.599-12.639-78.098 0a84.461 84.461 0 0 0-8.517 5.067L446.486 858.693l-.766.426c-19.392 12.059-25.337 37.556-13.278 56.948a41.325 41.325 0 0 0 14.257 13.868l634.492 375.585a83.589 83.589 0 0 0 8.517 5.068c24.498 12.639 53.599 12.639 78.098 0a82.535 82.535 0 0 0 8.517-5.068l634.492-375.585c12.675-7.39 20.413-21.012 20.268-35.685" />
      <path fill="#0364B8" d="M520.453 643.477h416.38v381.674h-416.38zM1745.917 255.5V80.908C1746.917 37.256 1712.365 1.046 1668.714 0H588.204C544.552 1.046 510 37.256 511 80.908V255.5l638.75 170.333z" />
      <path fill="#0078D4" d="M511 255.5h425.833v383.25H511z" />
      <path fill="#28A8EA" d="M1362.667 255.5H936.833v383.25L1362.667 1022h383.25V638.75z" />
      <path fill="#0078D4" d="M936.833 638.75h425.833V1022H936.833z" />
      <path fill="#0364B8" d="M936.833 1022h425.833v383.25H936.833z" />
      <path fill="#14447D" d="M520.453 1025.151h416.38v346.969h-416.38z" />
      <path fill="#0078D4" d="M1362.667 1022h383.25v383.25h-383.25z" />
      <path fill="#28A8EA" d="M1811.58 927.593l-.809.468-634.492 356.848a82.148 82.148 0 0 1-8.517 4.769c-24.641 12.038-53.457 12.038-78.098 0-2.918-1.445-5.76-3.037-8.517-4.769L446.657 928.061l-.766-.468c-12.25-6.642-19.93-19.409-20.057-33.343v722.384c.305 48.188 39.616 87.004 87.803 86.7h1229.64c48.188.307 87.5-38.509 87.807-86.696V894.25c-.016 13.817-7.468 26.557-19.504 33.343" />
      <path fill="#FFFFFF" d="M243.96 710.631c19.238-40.988 50.29-75.289 89.17-98.495 43.057-24.651 92.081-36.94 141.675-35.515 45.965-.997 91.321 10.655 131.114 33.683 37.414 22.312 67.547 55.004 86.742 94.109 20.904 43.09 31.322 90.512 30.405 138.396 1.013 50.043-9.706 99.628-31.299 144.783-19.652 40.503-50.741 74.36-89.425 97.388-41.327 23.734-88.367 35.692-136.011 34.578-46.947 1.133-93.303-10.651-134.01-34.067-37.738-22.341-68.249-55.07-87.892-94.28-21.028-42.467-31.57-89.355-30.745-136.735-.971-49.808 9.379-98.981 30.181-144.036m95.046 231.227c10.257 25.912 27.651 48.385 50.163 64.812 22.93 16.026 50.387 24.294 78.353 23.591 29.783 1.178 59.14-7.372 83.634-24.358 22.227-16.375 39.164-38.909 48.715-64.812 10.677-28.928 15.946-59.572 15.543-90.404.33-31.127-4.623-62.084-14.649-91.554-8.855-26.607-25.246-50.069-47.182-67.537-23.88-17.79-53.158-26.813-82.91-25.55-28.572-.74-56.644 7.593-80.184 23.804-22.893 16.496-40.617 39.168-51.1 65.365-23.255 60.049-23.376 126.595-.341 186.728Z" />
      <path fill="#50D9FF" d="M1362.667 255.5h383.25v383.25h-383.25z" />
    </svg>
  );
}



function AppIcon({ id, className }: { id: string; className?: string }) {
  const src = APP_ICON_ASSETS[id];
  if (!src) return <FileIcon className={className} />;
  return <img src={src} alt={id} className={`${className ?? ""} rounded`} />;
}
