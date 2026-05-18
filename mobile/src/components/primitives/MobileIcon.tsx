import Svg, { Circle, Line, Path, Polyline, Rect } from "react-native-svg";

import { colors } from "../../styles/tokens";

export type MobileIconName =
  | "home"
  | "workspaces"
  | "sessions"
  | "settings"
  | "github"
  | "apple"
  | "plus"
  | "send"
  | "search"
  | "more"
  | "chevron-right"
  | "chevron-left"
  | "close"
  | "menu"
  | "hand"
  | "check"
  | "slack"
  | "calendar-clock"
  | "users"
  | "cloud"
  | "smartphone"
  | "external"
  | "lock"
  | "filter"
  | "log-out"
  | "git-branch"
  | "shield"
  | "folder";

interface MobileIconProps {
  name: MobileIconName;
  size?: number;
  color?: string;
}

export function MobileIcon({ name, size = 18, color = colors.fg }: MobileIconProps) {
  const stroke = color;
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke,
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (name) {
    case "home":
      return (
        <Svg {...props}>
          <Path d="M3 11l9-7 9 7" />
          <Path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
        </Svg>
      );
    case "workspaces":
      return (
        <Svg {...props}>
          <Rect x="3" y="3" width="7" height="7" rx="1.5" />
          <Rect x="14" y="3" width="7" height="7" rx="1.5" />
          <Rect x="3" y="14" width="7" height="7" rx="1.5" />
          <Rect x="14" y="14" width="7" height="7" rx="1.5" />
        </Svg>
      );
    case "sessions":
      return (
        <Svg {...props}>
          <Path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </Svg>
      );
    case "settings":
      return (
        <Svg {...props}>
          <Circle cx="12" cy="12" r="3" />
          <Path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
        </Svg>
      );
    case "github":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
          <Path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18a10.93 10.93 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14v3.18c0 .31.21.67.8.56 4.56-1.52 7.85-5.83 7.85-10.91C23.5 5.65 18.35.5 12 .5z" />
        </Svg>
      );
    case "apple":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
          <Path d="M16.37 12.65c-.02-2.27 1.86-3.36 1.95-3.42-1.06-1.55-2.72-1.77-3.31-1.79-1.41-.14-2.75.83-3.46.83-.72 0-1.83-.81-3-.79-1.55.02-2.97.9-3.77 2.27-1.61 2.78-.41 6.9 1.16 9.16.77 1.11 1.69 2.36 2.91 2.32 1.17-.05 1.61-.76 3.02-.76s1.81.76 3.04.74c1.26-.02 2.05-1.13 2.81-2.25.89-1.29 1.26-2.55 1.28-2.62-.03-.01-2.45-.94-2.47-3.69zM14.06 5.96c.64-.78 1.07-1.86.95-2.94-.92.04-2.04.61-2.7 1.39-.59.69-1.11 1.79-.97 2.85 1.03.08 2.08-.52 2.72-1.3z" />
        </Svg>
      );
    case "plus":
      return (
        <Svg {...props}>
          <Line x1="12" y1="5" x2="12" y2="19" />
          <Line x1="5" y1="12" x2="19" y2="12" />
        </Svg>
      );
    case "send":
      return (
        <Svg {...props}>
          <Line x1="22" y1="2" x2="11" y2="13" />
          <Path d="M22 2L15 22l-4-9-9-4 20-7z" />
        </Svg>
      );
    case "search":
      return (
        <Svg {...props}>
          <Circle cx="11" cy="11" r="7" />
          <Line x1="21" y1="21" x2="16.65" y2="16.65" />
        </Svg>
      );
    case "more":
      return (
        <Svg {...props}>
          <Circle cx="5" cy="12" r="1.4" fill={color} stroke="none" />
          <Circle cx="12" cy="12" r="1.4" fill={color} stroke="none" />
          <Circle cx="19" cy="12" r="1.4" fill={color} stroke="none" />
        </Svg>
      );
    case "chevron-right":
      return (
        <Svg {...props}>
          <Polyline points="9 6 15 12 9 18" />
        </Svg>
      );
    case "chevron-left":
      return (
        <Svg {...props}>
          <Polyline points="15 6 9 12 15 18" />
        </Svg>
      );
    case "close":
      return (
        <Svg {...props}>
          <Line x1="18" y1="6" x2="6" y2="18" />
          <Line x1="6" y1="6" x2="18" y2="18" />
        </Svg>
      );
    case "menu":
      return (
        <Svg {...props}>
          <Line x1="4" y1="7" x2="20" y2="7" />
          <Line x1="4" y1="12" x2="20" y2="12" />
          <Line x1="4" y1="17" x2="20" y2="17" />
        </Svg>
      );
    case "hand":
      return (
        <Svg {...props}>
          <Path d="M11 11V5.5a1.5 1.5 0 1 1 3 0V11" />
          <Path d="M14 11V4a1.5 1.5 0 1 1 3 0v7" />
          <Path d="M17 11v-1a1.5 1.5 0 1 1 3 0v6a6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6v-2c0-.83.67-1.5 1.5-1.5S9 12.17 9 13v1" />
          <Path d="M11 11V6.5a1.5 1.5 0 1 0-3 0V14" />
        </Svg>
      );
    case "check":
      return (
        <Svg {...props}>
          <Polyline points="20 6 9 17 4 12" />
        </Svg>
      );
    case "slack":
      return (
        <Svg {...props}>
          <Rect x="13" y="2" width="3" height="8" rx="1.5" />
          <Rect x="14" y="14" width="8" height="3" rx="1.5" />
          <Rect x="8" y="14" width="3" height="8" rx="1.5" />
          <Rect x="2" y="7" width="8" height="3" rx="1.5" />
        </Svg>
      );
    case "calendar-clock":
      return (
        <Svg {...props}>
          <Path d="M16 14v2.2l1.6 1" />
          <Path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h7" />
          <Line x1="3" y1="10" x2="21" y2="10" />
          <Line x1="8" y1="2" x2="8" y2="6" />
          <Line x1="16" y1="2" x2="16" y2="6" />
          <Circle cx="17" cy="16" r="5" />
        </Svg>
      );
    case "users":
      return (
        <Svg {...props}>
          <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <Circle cx="9" cy="7" r="4" />
          <Path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <Path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </Svg>
      );
    case "cloud":
      return (
        <Svg {...props}>
          <Path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.78A6 6 0 1 0 6 14a3.5 3.5 0 0 0-.5 7H17.5z" />
        </Svg>
      );
    case "smartphone":
      return (
        <Svg {...props}>
          <Rect x="6" y="2" width="12" height="20" rx="2.5" />
          <Line x1="11" y1="18" x2="13" y2="18" />
        </Svg>
      );
    case "external":
      return (
        <Svg {...props}>
          <Path d="M15 3h6v6" />
          <Path d="M10 14L21 3" />
          <Path d="M21 13v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h7" />
        </Svg>
      );
    case "lock":
      return (
        <Svg {...props}>
          <Rect x="4" y="11" width="16" height="10" rx="2" />
          <Path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </Svg>
      );
    case "filter":
      return (
        <Svg {...props}>
          <Path d="M3 5h18l-7 9v6l-4-2v-4z" />
        </Svg>
      );
    case "log-out":
      return (
        <Svg {...props}>
          <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <Polyline points="16 17 21 12 16 7" />
          <Line x1="21" y1="12" x2="9" y2="12" />
        </Svg>
      );
    case "git-branch":
      return (
        <Svg {...props}>
          <Line x1="6" y1="3" x2="6" y2="15" />
          <Circle cx="18" cy="6" r="3" />
          <Circle cx="6" cy="18" r="3" />
          <Path d="M18 9a9 9 0 0 1-9 9" />
        </Svg>
      );
    case "shield":
      return (
        <Svg {...props}>
          <Path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" />
        </Svg>
      );
    case "folder":
      return (
        <Svg {...props}>
          <Path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </Svg>
      );
  }
}
