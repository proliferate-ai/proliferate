import type { IconProps } from "./types";

export function Robot({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 8V4" />
      <circle cx="12" cy="4" r="1" />
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <path d="M9 13h.01" />
      <path d="M15 13h.01" />
      <path d="M9 17h6" />
      <path d="M3 12v3" />
      <path d="M21 12v3" />
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

export function ClipboardListFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M9.5 2A1.5 1.5 0 0 0 8 3.5v1A1.5 1.5 0 0 0 9.5 6h5A1.5 1.5 0 0 0 16 4.5v-1A1.5 1.5 0 0 0 14.5 2h-5Z" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6.5 4.04c-1.25.07-2.05.27-2.62.84C3 5.76 3 7.17 3 10v6c0 2.83 0 4.24.88 5.12C4.76 22 6.17 22 9 22h6c2.83 0 4.24 0 5.12-.88C21 20.24 21 18.83 21 16v-6c0-2.83 0-4.24-.88-5.12c-.57-.57-1.37-.77-2.62-.84v.46a3 3 0 0 1-3 3h-5a3 3 0 0 1-3-3v-.46ZM8 11.25a1 1 0 1 1 2 0a1 1 0 0 1-2 0Zm4-.75a.75.75 0 0 0 0 1.5h4a.75.75 0 0 0 0-1.5h-4ZM8 16.25a1 1 0 1 1 2 0a1 1 0 0 1-2 0Zm4-.75a.75.75 0 0 0 0 1.5h4a.75.75 0 0 0 0-1.5h-4Z"
      />
    </svg>
  );
}

export function ReadModeFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M6.5 3A2.5 2.5 0 0 0 4 5.5v13A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V9a1 1 0 0 0-.29-.71l-5-5A1 1 0 0 0 14 3H6.5Zm6.5 1.5V9a1 1 0 0 0 1 1h4.5L13 4.5ZM8.75 12h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5Zm0 3.5h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5Z" />
    </svg>
  );
}

export function EditModeFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M17.94 2.72a2.55 2.55 0 0 1 3.34 3.34L8.31 19.03a3 3 0 0 1-1.25.75l-4.15 1.18a.75.75 0 0 1-.93-.93l1.18-4.15a3 3 0 0 1 .75-1.25L17.94 2.72Z" />
      <path d="M15.25 5.41 18.6 8.75" className="opacity-45" />
    </svg>
  );
}

export function BuildModeFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M14.9 2.62a2.1 2.1 0 0 1 2.97 0l1.5 1.5a2.1 2.1 0 0 1 0 2.97l-.71.71a1 1 0 0 1-1.42 0l-.52-.52-2.38 2.38 6.28 6.28a2 2 0 0 1 0 2.82l-1.86 1.86a2 2 0 0 1-2.82 0L9.66 14.34l-2.27 2.27.5.5a1 1 0 0 1 0 1.42l-.8.8a2.1 2.1 0 0 1-2.97 0l-1.45-1.45a2.1 2.1 0 0 1 0-2.97l.8-.8a1 1 0 0 1 1.42 0l.5.5 2.27-2.27-.45-.45a2.2 2.2 0 0 1 0-3.11l1.57-1.57a2.2 2.2 0 0 1 3.11 0l.45.45 2.38-2.38-.52-.52a1 1 0 0 1 0-1.42l.7-.72Z" />
    </svg>
  );
}

export function OpencodeBuildModeFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M5.5 4A3.5 3.5 0 0 0 2 7.5v9A3.5 3.5 0 0 0 5.5 20h13a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 18.5 4h-13Zm3.03 5.47 2 2a.75.75 0 0 1 0 1.06l-2 2a.75.75 0 0 1-1.06-1.06L8.94 12l-1.47-1.47a.75.75 0 1 1 1.06-1.06ZM12.75 13.5h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5Z" />
    </svg>
  );
}

export function OpencodePlanModeFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M8.75 2.75A1.75 1.75 0 0 0 7 4.5V5H6a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3h-1v-.5a1.75 1.75 0 0 0-1.75-1.75h-6.5ZM8.5 6V4.5a.25.25 0 0 1 .25-.25h6.5a.25.25 0 0 1 .25.25V6a.75.75 0 0 1-.75.75h-5.5A.75.75 0 0 1 8.5 6Zm-1.78 5.03a.75.75 0 0 1 1.06-1.06l.72.72 1.72-1.72a.75.75 0 1 1 1.06 1.06l-2.25 2.25a.75.75 0 0 1-1.06 0l-1.25-1.25ZM13 10.75a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75Zm-5.22 4.22a.75.75 0 0 0-1.06 1.06l1.25 1.25c.3.3.77.3 1.06 0l2.25-2.25a.75.75 0 0 0-1.06-1.06L8.5 15.69l-.72-.72ZM13.75 15h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1 0-1.5Z" />
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

export function Brain({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M10.05 2.25a3.55 3.55 0 0 1 3.45 3.63a2.9 2.9 0 0 1-3.05 2.95c-.76 0-1.42-.2-1.96-.6c-.6 1.9-.48 4.1.3 5.85a5.9 5.9 0 0 1 5.14-3.05C18.42 11.03 22 13.68 22 17c0 3.18-3.72 5-8.98 5c-4.3 0-8.2-.76-10.26-2.25A1.78 1.78 0 0 1 2 18.26C2.16 12.22 2.95 2.25 10.05 2.25Z" />
      <path d="M14.05 12.9a4 4 0 0 0-3.95 3.35c1.12-.7 2.43-1.06 3.9-1.06c1.83 0 3.36.56 4.47 1.56A4.04 4.04 0 0 0 14.05 12.9Z" opacity=".72" />
    </svg>
  );
}

export function ThinkingGlyph({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M11.75 3.25c4.56 0 8.25 3.09 8.25 6.9c0 3.8-3.69 6.88-8.25 6.88c-.72 0-1.42-.08-2.08-.23L5.9 19.85a.75.75 0 0 1-1.2-.7l.78-3.5C4.24 14.43 3.5 12.5 3.5 10.15c0-3.81 3.69-6.9 8.25-6.9Zm-3 7.65a1.05 1.05 0 1 0 0-2.1a1.05 1.05 0 0 0 0 2.1Zm3 0a1.05 1.05 0 1 0 0-2.1a1.05 1.05 0 0 0 0 2.1Zm3 0a1.05 1.05 0 1 0 0-2.1a1.05 1.05 0 0 0 0 2.1Z" />
    </svg>
  );
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

export function ScratchPadIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 9c1-1.5 2-1.5 3 0s2 1.5 3 0 2-1.5 3 0" />
      <path d="M8 15c1-1.5 2-1.5 3 0s2 1.5 3 0" />
    </svg>
  );
}

export function Zap({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M14.62 1.6a.75.75 0 0 1 .35.85L12.98 9.75h7.27a.75.75 0 0 1 .55 1.26l-10.5 11.25a.75.75 0 0 1-1.27-.71l1.99-7.3H3.75a.75.75 0 0 1-.55-1.26l10.5-11.25a.75.75 0 0 1 .92-.14Z"
      />
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
      <path d="M11.5 2.85a.65.65 0 0 1 1 0l1.66 4.34a2.5 2.5 0 0 0 1.45 1.45l4.34 1.66a.65.65 0 0 1 0 1l-4.34 1.66a2.5 2.5 0 0 0-1.45 1.45l-1.66 4.34a.65.65 0 0 1-1 0l-1.66-4.34a2.5 2.5 0 0 0-1.45-1.45L4.05 11.3a.65.65 0 0 1 0-1l4.34-1.66a2.5 2.5 0 0 0 1.45-1.45L11.5 2.85Z" />
      <path d="M18.75 2.75a.5.5 0 0 1 .5.5v1.5h1.5a.5.5 0 0 1 0 1h-1.5v1.5a.5.5 0 0 1-1 0v-1.5h-1.5a.5.5 0 0 1 0-1h1.5v-1.5a.5.5 0 0 1 .5-.5Z" />
      <path d="M5.25 16.25a.5.5 0 0 1 .5.5v1.5h1.5a.5.5 0 0 1 0 1h-1.5v1.5a.5.5 0 0 1-1 0v-1.5h-1.5a.5.5 0 0 1 0-1h1.5v-1.5a.5.5 0 0 1 .5-.5Z" />
    </svg>
  );
}

export function BotMessageSquare({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 6V3" />
      <circle cx="12" cy="3" r="1" />
      <path d="M5 8h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
      <path d="M9 13h.01" />
      <path d="M15 13h.01" />
      <path d="M10 16h4" />
    </svg>
  );
}
