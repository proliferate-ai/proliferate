import type { IconProps } from "./types";

export type CommandPaletteGlyphName =
  | "arrow-left"
  | "arrow-right"
  | "arrow-up-right"
  | "chat"
  | "circle-help"
  | "cloud-plus"
  | "cloud-upload"
  | "command"
  | "folder"
  | "folder-plus"
  | "git-branch"
  | "globe"
  | "home"
  | "keyboard"
  | "panel-left"
  | "panel-right"
  | "pencil"
  | "play"
  | "rotate-ccw"
  | "search"
  | "settings"
  | "square-pen"
  | "square-terminal"
  | "workflow";

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
      strokeWidth={1.75}
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
    case "arrow-up-right":
      return (
        <>
          <path d="M7 7h10v10" />
          <path d="M7 17 17 7" />
        </>
      );
    case "chat":
      return <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />;
    case "circle-help":
      return (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
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
    case "cloud-upload":
      return (
        <>
          <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
          <path d="M12 12v9" />
          <path d="m16 16-4-4-4 4" />
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
    case "folder":
      return <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />;
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
    case "globe":
      return (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
          <path d="M2 12h20" />
        </>
      );
    case "home":
      return (
        <>
          <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
          <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </>
      );
    case "keyboard":
      return (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M7 9h.01" />
          <path d="M11 9h.01" />
          <path d="M15 9h.01" />
          <path d="M7 13h.01" />
          <path d="M11 13h6" />
        </>
      );
    case "panel-left":
      return (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18" />
        </>
      );
    case "panel-right":
      return (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M15 3v18" />
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
    case "square-pen":
      return (
        <>
          <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
        </>
      );
    case "square-terminal":
      return (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="m7 11 2-2-2-2" />
          <path d="M11 13h4" />
        </>
      );
    case "workflow":
      return (
        <>
          <rect x="3" y="3" width="8" height="8" rx="2" />
          <rect x="13" y="13" width="8" height="8" rx="2" />
          <path d="M7 11v4a2 2 0 0 0 2 2h4" />
        </>
      );
  }
}
