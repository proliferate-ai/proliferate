import type { SVGProps } from "react";

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

export function CalendarClock({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
      <circle cx="16" cy="16" r="6" />
      <path d="M16 13v3l2 1" />
    </svg>
  );
}

export function CreditCard({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
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

export function InlinePathMentionIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} width="10" height="10" viewBox="0 0 10 10" fill="none" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5.62988 1.12599C5.9198 1.12599 6.11903 1.12407 6.31006 1.16993L6.42969 1.20362C6.54783 1.24203 6.66141 1.29433 6.76758 1.35939L6.8291 1.39943C6.97079 1.49824 7.09992 1.62972 7.2793 1.80909L7.77442 2.30421L7.91651 2.44728C8.04775 2.58071 8.14716 2.69039 8.22412 2.81593L8.28516 2.92482C8.34146 3.0354 8.38453 3.1525 8.41358 3.27345L8.42871 3.34571C8.459 3.51573 8.45752 3.70002 8.45752 3.95362V6.542C8.45752 6.88641 8.45784 7.16509 8.43945 7.39015C8.42307 7.59041 8.39048 7.77088 8.31836 7.93898L8.28516 8.01027C8.15244 8.27068 7.95039 8.48862 7.70264 8.64064L7.59326 8.70167C7.40494 8.7976 7.20206 8.83726 6.97315 8.85597C6.74803 8.87436 6.46954 8.87452 6.125 8.87452H3.875C3.53046 8.87452 3.25197 8.87436 3.02686 8.85597C2.82659 8.8396 2.64613 8.80745 2.47803 8.73536L2.40674 8.70167C2.14617 8.56891 1.92793 8.36707 1.77588 8.11915L1.71484 8.01027C1.61894 7.822 1.57927 7.61897 1.56055 7.39015C1.54216 7.16509 1.54248 6.88641 1.54248 6.542V3.45851C1.54248 3.11403 1.54217 2.83546 1.56055 2.61036C1.57925 2.38151 1.61898 2.17852 1.71484 1.99025C1.86655 1.6925 2.109 1.45007 2.40674 1.29835C2.59504 1.20245 2.79796 1.16276 3.02686 1.14405C3.25198 1.12566 3.53045 1.12599 3.875 1.12599H5.62988ZM3.875 1.79103C3.51948 1.79103 3.27281 1.79147 3.08106 1.80714C2.89321 1.82249 2.7875 1.85087 2.7085 1.89112C2.5359 1.97909 2.39557 2.1194 2.30762 2.292C2.26739 2.37099 2.23898 2.4768 2.22363 2.66456C2.20798 2.8563 2.20752 3.10308 2.20752 3.45851V6.542C2.20752 6.89736 2.20797 7.14424 2.22363 7.33595C2.23899 7.52361 2.26738 7.62955 2.30762 7.70851L2.34277 7.7715C2.43093 7.91522 2.55744 8.03242 2.7085 8.10939L2.77344 8.13722C2.84532 8.16295 2.94008 8.18185 3.08106 8.19337C3.27281 8.20904 3.51949 8.20948 3.875 8.20948H6.125C6.48051 8.20948 6.72719 8.20904 6.91895 8.19337C7.10673 8.17803 7.21251 8.14961 7.29151 8.10939L7.35449 8.07374C7.49817 7.98564 7.6154 7.85948 7.69238 7.70851L7.7207 7.64308C7.74635 7.57129 7.76487 7.47652 7.77637 7.33595C7.79203 7.14424 7.79248 6.89736 7.79248 6.542V4.27882L6.67529 4.1548C6.12859 4.09405 5.69878 3.65917 5.64404 3.11183L5.51172 1.79103H3.875ZM6.30567 3.04591C6.32918 3.281 6.51374 3.46752 6.74854 3.49366L7.78809 3.60939C7.78635 3.56879 7.7843 3.53557 7.78076 3.50636L7.76709 3.42872C7.75025 3.35858 7.72504 3.29071 7.69238 3.22657L7.65723 3.16359C7.63125 3.1212 7.59976 3.0807 7.54639 3.02247L7.3042 2.77443L6.80908 2.27931C6.63847 2.1087 6.55244 2.02455 6.48438 1.9712L6.41992 1.92628C6.35836 1.88856 6.29263 1.85821 6.22412 1.83595L6.18359 1.82423L6.30567 3.04591Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function FileCode({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="m10 13-2 2 2 2" />
      <path d="m14 17 2-2-2-2" />
    </svg>
  );
}

export function StackedFiles({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4.5 2.25h4.25l3.75 3.75v7a.75.75 0 0 1-.75.75H4.5a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 1-1Z" />
      <path d="M8.75 2.25v3.5a.25.25 0 0 0 .25.25h3.5" />
    </svg>
  );
}

export function AppShellReviewIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M12.084 12.668a.666.666 0 0 1 0 1.33H7.917a.665.665 0 1 1 0-1.33h4.167ZM10 5.585c.367 0 .665.298.665.665v1.418h1.419a.666.666 0 0 1 0 1.33h-1.419v1.419a.666.666 0 0 1-1.33 0V8.998H7.917a.665.665 0 0 1 0-1.33h1.418V6.25c0-.367.298-.665.665-.665Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M12.667 2.668c.689 0 1.246 0 1.696.036.458.038.865.117 1.242.309a3.163 3.163 0 0 1 1.382 1.383c.192.377.272.783.309 1.24.037.45.036 1.008.036 1.697v5.333c0 .689 0 1.246-.036 1.696-.037.458-.117.865-.309 1.242a3.166 3.166 0 0 1-1.382 1.382c-.377.192-.784.271-1.242.309-.45.037-1.007.036-1.696.036H7.334c-.689 0-1.246 0-1.696-.036-.458-.038-.864-.117-1.24-.309a3.166 3.166 0 0 1-1.384-1.383c-.192-.376-.271-.783-.309-1.24-.037-.45-.036-1.008-.036-1.697V7.333c0-.689 0-1.246.036-1.696.038-.458.117-.864.309-1.24a3.17 3.17 0 0 1 1.383-1.384c.377-.192.783-.272 1.24-.309.45-.037 1.008-.036 1.697-.036h5.333Zm-5.333 1.33c-.71 0-1.204.001-1.588.032-.375.03-.587.088-.745.168A1.836 1.836 0 0 0 4.199 5c-.08.158-.137.37-.168.745C4 6.13 4 6.622 4 7.333v5.333c0 .71.001 1.204.032 1.588.03.375.088.587.168.745.176.345.457.627.802.803.158.08.37.137.745.168.384.031.877.031 1.588.031h5.333c.71 0 1.204 0 1.588-.031.375-.031.587-.088.745-.168a1.84 1.84 0 0 0 .803-.803c.08-.158.137-.37.168-.745.031-.383.031-.877.031-1.588V7.333c0-.71 0-1.204-.031-1.588-.031-.375-.088-.587-.168-.745A1.838 1.838 0 0 0 15 4.198c-.158-.08-.37-.137-.745-.168-.384-.031-.877-.032-1.588-.032H7.334Z" />
    </svg>
  );
}

export function AppShellBrowserIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M10 2.125C14.3492 2.125 17.875 5.65076 17.875 10C17.875 14.3492 14.3492 17.875 10 17.875C5.65076 17.875 2.125 14.3492 2.125 10C2.125 5.65076 5.65076 2.125 10 2.125ZM7.88672 10.625C7.94334 12.3161 8.22547 13.8134 8.63965 14.9053C8.87263 15.5194 9.1351 15.9733 9.39453 16.2627C9.65437 16.5524 9.86039 16.625 10 16.625C10.1396 16.625 10.3456 16.5524 10.6055 16.2627C10.8649 15.9733 11.1274 15.5194 11.3604 14.9053C11.7745 13.8134 12.0567 12.3161 12.1133 10.625H7.88672ZM3.40527 10.625C3.65313 13.2734 5.45957 15.4667 7.89844 16.2822C7.7409 15.997 7.5977 15.6834 7.4707 15.3486C6.99415 14.0923 6.69362 12.439 6.63672 10.625H3.40527ZM13.3633 10.625C13.3064 12.439 13.0059 14.0923 12.5293 15.3486C12.4022 15.6836 12.2582 15.9969 12.1006 16.2822C14.5399 15.467 16.3468 13.2737 16.5947 10.625H13.3633ZM12.1006 3.7168C12.2584 4.00235 12.4021 4.31613 12.5293 4.65137C13.0059 5.90775 13.3064 7.56102 13.3633 9.375H16.5947C16.3468 6.72615 14.54 4.53199 12.1006 3.7168ZM10 3.375C9.86039 3.375 9.65437 3.44756 9.39453 3.7373C9.1351 4.02672 8.87263 4.48057 8.63965 5.09473C8.22547 6.18664 7.94334 7.68388 7.88672 9.375H12.1133C12.0567 7.68388 11.7745 6.18664 11.3604 5.09473C11.1274 4.48057 10.8649 4.02672 10.6055 3.7373C10.3456 3.44756 10.1396 3.375 10 3.375ZM7.89844 3.7168C5.45942 4.53222 3.65314 6.72647 3.40527 9.375H6.63672C6.69362 7.56102 6.99415 5.90775 7.4707 4.65137C7.59781 4.31629 7.74073 4.00224 7.89844 3.7168Z" />
    </svg>
  );
}

export function AppShellTerminalIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M6.19629 7.86231C6.42357 7.63534 6.7752 7.60692 7.0332 7.77734L7.1377 7.86231L8.80371 9.5293C9.06329 9.78889 9.06307 10.21 8.80371 10.4697L7.1377 12.1367C6.878 12.3964 6.45599 12.3964 6.19629 12.1367C5.93686 11.8771 5.93697 11.456 6.19629 11.1963L7.39258 9.99902L6.19629 8.80371L6.11133 8.69922C5.94087 8.4411 5.96904 8.08955 6.19629 7.86231Z" fill="currentColor" />
      <path d="M13.4668 11.0156C13.7699 11.0776 13.998 11.3456 13.998 11.667C13.9979 11.9883 13.7698 12.2564 13.4668 12.3184L13.333 12.332H10.833C10.466 12.3319 10.1682 12.034 10.168 11.667C10.168 11.2998 10.4659 11.0021 10.833 11.002H13.333L13.4668 11.0156Z" fill="currentColor" />
      <path fillRule="evenodd" clipRule="evenodd" d="M12.6602 2.66504C13.3492 2.66504 13.9062 2.66439 14.3564 2.70117C14.8142 2.73859 15.2201 2.81796 15.5967 3.00977C16.1922 3.31321 16.677 3.79805 16.9805 4.39356C17.1722 4.77014 17.2517 5.17604 17.2891 5.63379C17.3258 6.08402 17.3252 6.64102 17.3252 7.33008V12.6602C17.3252 13.3492 17.3258 13.9062 17.2891 14.3564C17.2516 14.8142 17.1723 15.2201 16.9805 15.5967C16.677 16.1922 16.1922 16.677 15.5967 16.9805C15.2201 17.1723 14.8142 17.2516 14.3564 17.2891C13.9062 17.3258 13.3492 17.3252 12.6602 17.3252H7.33008C6.64102 17.3252 6.08402 17.3258 5.63379 17.2891C5.17604 17.2517 4.77014 17.1722 4.39356 16.9805C3.79805 16.677 3.31321 16.1922 3.00977 15.5967C2.81796 15.2201 2.73859 14.8142 2.70117 14.3564C2.66439 13.9062 2.66504 13.3492 2.66504 12.6602V7.33008C2.66504 6.64101 2.66439 6.08402 2.70117 5.63379C2.73858 5.17601 2.81797 4.77016 3.00977 4.39356C3.31321 3.79802 3.79802 3.31321 4.39356 3.00977C4.77016 2.81797 5.17601 2.73858 5.63379 2.70117C6.08402 2.66439 6.64101 2.66504 7.33008 2.66504H12.6602ZM7.33008 3.99512C6.61907 3.99512 6.1257 3.99601 5.74219 4.02734C5.3665 4.05804 5.15508 4.11481 4.99707 4.19531C4.65183 4.37124 4.37124 4.65183 4.19531 4.99707C4.11481 5.15508 4.05805 5.3665 4.02734 5.74219C3.99601 6.1257 3.99512 6.61908 3.99512 7.33008V12.6602C3.99512 13.3711 3.99601 13.8646 4.02734 14.248C4.05805 14.6237 4.11481 14.8352 4.19531 14.9932C4.37124 15.3384 4.65186 15.619 4.99707 15.7949C5.15507 15.8754 5.36654 15.9322 5.74219 15.9629C6.1257 15.9942 6.61908 15.9951 7.33008 15.9951H12.6602C13.3711 15.9951 13.8646 15.9942 14.248 15.9629C14.6237 15.9322 14.8352 15.8754 14.9932 15.7949C15.3384 15.619 15.619 15.3384 15.7949 14.9932C15.8754 14.8352 15.9322 14.6237 15.9629 14.248C15.9942 13.8646 15.9951 13.3711 15.9951 12.6602V7.33008C15.9951 6.61908 15.9942 6.1257 15.9629 5.74219C15.9322 5.36654 15.8754 5.15507 15.7949 4.99707C15.619 4.65186 15.3384 4.37124 14.9932 4.19531C14.8352 4.11481 14.6237 4.05805 14.248 4.02734C13.8646 3.99601 13.3711 3.99512 12.6602 3.99512H7.33008Z" fill="currentColor" />
    </svg>
  );
}

export function AppShellPlusIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M9.33496 16.5V10.665H3.5C3.13273 10.665 2.83496 10.3673 2.83496 10C2.83496 9.63273 3.13273 9.33496 3.5 9.33496H9.33496V3.5C9.33496 3.13273 9.63273 2.83496 10 2.83496C10.3673 2.83496 10.665 3.13273 10.665 3.5V9.33496H16.5L16.6338 9.34863C16.9369 9.41057 17.165 9.67857 17.165 10C17.165 10.3214 16.9369 10.5894 16.6338 10.6514L16.5 10.665H10.665V16.5C10.665 16.8673 10.3673 17.165 10 17.165C9.63273 17.165 9.33496 16.8673 9.33496 16.5Z" fill="currentColor" />
    </svg>
  );
}

export function AppShellPanelToggleIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M4.33496 11C4.33496 10.6327 4.63273 10.335 5 10.335C5.36727 10.335 5.66504 10.6327 5.66504 11V14.335H9L9.13379 14.3486C9.43692 14.4106 9.66504 14.6786 9.66504 15C9.66504 15.3214 9.43692 15.5894 9.13379 15.6514L9 15.665H5C4.63273 15.665 4.33496 15.3673 4.33496 15V11ZM14.335 9V5.66504H11C10.6327 5.66504 10.335 5.36727 10.335 5C10.335 4.63273 10.6327 4.33496 11 4.33496H15L15.1338 4.34863C15.4369 4.41057 15.665 4.67857 15.665 5V9C15.665 9.36727 15.3673 9.66504 15 9.66504C14.6327 9.66504 14.335 9.36727 14.335 9Z" fill="currentColor" />
    </svg>
  );
}

export function AppShellTabCloseIcon({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M10.7997 2.48486C15.4019 2.48486 19.1335 6.21565 19.1337 10.8179C19.1337 15.4202 15.4021 19.1519 10.7997 19.1519C6.19746 19.1517 2.46667 15.4201 2.46667 10.8179C2.46685 6.21576 6.19757 2.48504 10.7997 2.48486ZM9.00811 7.5181C8.62612 7.13627 8.00684 7.13624 7.62534 7.5181C7.24363 7.89971 7.24366 8.51913 7.62534 8.90088L9.54183 10.8179L7.62534 12.7343C7.24375 13.116 7.24365 13.7354 7.62534 14.1171C8.00709 14.4989 8.62647 14.4989 9.00811 14.1171L10.9251 12.2007L12.8416 14.1171C13.2234 14.4989 13.8427 14.4989 14.2244 14.1171C14.6062 13.7354 14.6062 13.1161 14.2244 12.7343L12.3079 10.8179L14.2244 8.90088L14.3123 8.79221C14.5632 8.41306 14.5212 7.89785 14.2244 7.60088C13.9275 7.30404 13.4123 7.26211 13.0331 7.51303L12.9244 7.60088L11.0079 9.51736L9.09138 7.60088L9.00811 7.5181Z" fill="currentColor" />
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

export function SlidersHorizontal({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 6h4" />
      <path d="M11 6h10" />
      <path d="M3 12h10" />
      <path d="M17 12h4" />
      <path d="M3 18h7" />
      <path d="M14 18h7" />
      <circle cx="9" cy="6" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="12" cy="18" r="2" />
    </svg>
  );
}

export function Palette({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 3a9 9 0 0 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12a2 2 0 0 1 0-4h4.5A4.5 4.5 0 0 0 21 7.5C21 5 17 3 12 3Z" />
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

export function LifeBuoy({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="m4.93 4.93 4.24 4.24" />
      <path d="m14.83 9.17 4.24-4.24" />
      <path d="m14.83 14.83 4.24 4.24" />
      <path d="m9.17 14.83-4.24 4.24" />
      <circle cx="12" cy="12" r="4" />
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

export function BuildModeFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M14.9 2.62a2.1 2.1 0 0 1 2.97 0l1.5 1.5a2.1 2.1 0 0 1 0 2.97l-.71.71a1 1 0 0 1-1.42 0l-.52-.52-2.38 2.38 6.28 6.28a2 2 0 0 1 0 2.82l-1.86 1.86a2 2 0 0 1-2.82 0L9.66 14.34l-2.27 2.27.5.5a1 1 0 0 1 0 1.42l-.8.8a2.1 2.1 0 0 1-2.97 0l-1.45-1.45a2.1 2.1 0 0 1 0-2.97l.8-.8a1 1 0 0 1 1.42 0l.5.5 2.27-2.27-.45-.45a2.2 2.2 0 0 1 0-3.11l1.57-1.57a2.2 2.2 0 0 1 3.11 0l.45.45 2.38-2.38-.52-.52a1 1 0 0 1 0-1.42l.7-.72Z" />
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
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 2a3 3 0 0 1 2 .765A3 3 0 0 1 17.122 4a3.5 3.5 0 0 1 2.742 4.465A4.028 4.028 0 0 1 22 12c0 1.076-.429 2.088-1.173 2.834A4.008 4.008 0 0 1 17.69 19.94A3.5 3.5 0 0 1 12 20.915A3.5 3.5 0 0 1 6.306 19.934A4.008 4.008 0 0 1 3.17 14.832A4.003 4.003 0 0 1 4.136 8.465A3.5 3.5 0 0 1 6.878 4A3.005 3.005 0 0 1 10 2Zm1 3a1 1 0 0 0-2 0v1.207l-1.186-.175a1.5 1.5 0 0 0-1.5 2.39l1.061 1.346l-1.693.26A2.003 2.003 0 0 0 4 12c0 .684.346 1.316.925 1.693l.784.51l-.456.816A1.974 1.974 0 0 0 5 16c0 1.103.897 2 2 2h.818l.162.802A1.502 1.502 0 0 0 11 18.5V5Zm2 13.5a1.502 1.502 0 0 0 3.02.302l.162-.802H17c1.103 0 2-.897 2-2c0-.352-.085-.682-.253-.981l-.456-.816l.784-.51c.579-.377.925-1.01.925-1.693c0-.977-.723-1.824-1.682-1.972l-1.693-.26l1.06-1.346a1.5 1.5 0 0 0-1.499-2.39L15 6.207V5a1 1 0 0 0-2 0v13.5Z"
      />
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
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
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

/** Filled closed folder matching Codex's sidebar project folders */
export function FolderClosedFilled({ className, ...props }: IconProps) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 20 20" {...props}>
      <path d="M6.584 2.835h.695c.143 0 .243 0 .341.006l.254.026a3.01 3.01 0 0 1 1.582.738l.245.24c.112.113.149.15.185.182.267.2.586.32.92.34l.26.003h2.626c.559 0 1.012 0 1.381.026.375.027.713.085 1.032.224l.264.128a3.165 3.165 0 0 1 1.34 1.475l.087.242c.074.246.11.504.13.783.026.366.026.815.026 1.368v4.084c0 .654.001 1.185-.034 1.614-.036.437-.112.827-.297 1.19l-.117.21a3.168 3.168 0 0 1-1.212 1.119l-.138.064c-.324.139-.67.201-1.053.232-.429.035-.96.034-1.614.034H6.585c-.654 0-1.185.001-1.614-.034-.382-.031-.729-.093-1.053-.232l-.138-.064a3.168 3.168 0 0 1-1.212-1.119l-.117-.21c-.185-.363-.261-.753-.297-1.19-.035-.429-.034-.96-.034-1.614V7.3c0-.654-.001-1.185.034-1.614.036-.437.112-.827.297-1.19l.117-.21a3.168 3.168 0 0 1 1.212-1.119l.138-.064c.324-.139.67-.201 1.053-.232.429-.035.96-.034 1.614-.034Zm0 1.33c-.676 0-1.143.001-1.506.031-.266.022-.443.057-.575.104l-.12.052a1.833 1.833 0 0 0-.682.629l-.065.118c-.074.145-.127.341-.156.696-.03.363-.03.83-.03 1.506v5.4c0 .676.001 1.143.03 1.506.029.355.082.551.156.696l.065.118c.164.268.4.486.682.629l.12.052c.132.047.309.082.575.104.363.03.83.031 1.506.031h6.83c.676 0 1.143-.001 1.506-.031.266-.022.443-.057.575-.104l.12-.052c.282-.143.518-.361.682-.629l.065-.118c.074-.145.127-.341.156-.696.03-.363.03-.83.03-1.506V8.615c0-.577-.001-.976-.023-1.287-.021-.305-.06-.476-.114-.603l-.072-.148a1.835 1.835 0 0 0-.754-.753c-.127-.054-.298-.093-.603-.114-.311-.022-.71-.023-1.287-.023h-2.626l-.342-.006a3.004 3.004 0 0 1-1.638-.604l-.197-.162a6.28 6.28 0 0 1-.243-.239l-.186-.182a1.75 1.75 0 0 0-.891-.312l-.142-.015c-.048-.003-.1-.003-.26-.003h-.695Z" />
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

export function WrapText({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M10.33 12.668c.367 0 .665.298.665.665l.002 3.333a.665.665 0 0 1-1.33.001l-.002-3.334c0-.367.298-.665.665-.665Zm3.364-5.639a.665.665 0 0 1 .94 0l2.5 2.5c.26.26.26.682 0 .942l-2.5 2.5a.666.666 0 0 1-.94-.942l1.365-1.364H3.33a.665.665 0 1 1 0-1.33h11.728l-1.365-1.364a.666.666 0 0 1 0-.942ZM10.33 2.668c.367 0 .665.298.665.665l.002 3.333a.665.665 0 0 1-1.33.001l-.002-3.334c0-.367.298-.665.665-.665Z" />
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

export { Spinner } from "@proliferate/ui/primitives/Spinner";

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

export function Zap({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.47 3.84a.75.75 0 0 1 1.37.53l-1.37 5.13H18a.75.75 0 0 1 .59 1.21l-8.25 10.5a.75.75 0 0 1-1.32-.64l1.37-5.07H6a.75.75 0 0 1-.59-1.21l6.06-10.45Z"
      />
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

export function Building2({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18" />
      <path d="M3 22h18" />
      <path d="M10 6h.01" />
      <path d="M14 6h.01" />
      <path d="M10 10h.01" />
      <path d="M14 10h.01" />
      <path d="M10 14h.01" />
      <path d="M14 14h.01" />
      <path d="M10 22v-4h4v4" />
    </svg>
  );
}

export function UsersRound({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M18 21a6 6 0 0 0-12 0" />
      <circle cx="12" cy="9" r="4" />
      <path d="M22 20a4 4 0 0 0-3-3.87" />
      <path d="M16 5.13a4 4 0 0 1 0 7.75" />
      <path d="M2 20a4 4 0 0 1 3-3.87" />
      <path d="M8 5.13a4 4 0 0 0 0 7.75" />
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
      <path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z" />
      <path d="M12 22v-3" />
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

export function Server({ className, ...props }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 8h.01" />
      <path d="M7 17h.01" />
      <path d="M11 8h6" />
      <path d="M11 17h6" />
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
