import type { IconProps } from "./icons";

export type CommandPaletteGlyphName =
  | "arrow-left"
  | "arrow-right"
  | "chat"
  | "chat-plus"
  | "cloud-plus"
  | "command"
  | "folder-plus"
  | "git-branch"
  | "keyboard"
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
