export const colors = {
  background: "#181818",
  foreground: "#ffffff",
  overlay: "#000000",
  overlayStrong: "rgba(0,0,0,0.58)",
  primary: "#ffffff",
  primaryForeground: "#181818",
  secondary: "#212121",
  secondaryForeground: "#ffffff",
  accent: "rgba(255,255,255,0.05)",
  accentForeground: "#ffffff",
  muted: "#212121",
  mutedForeground: "rgba(255,255,255,0.71)",
  faint: "rgba(255,255,255,0.50)",
  helper: "rgba(255,255,255,0.71)",
  card: "#212121",
  cardForeground: "#ffffff",
  popover: "#242424",
  popoverForeground: "#ffffff",
  popoverAccent: "rgba(255,255,255,0.05)",
  popoverRing: "rgba(255,255,255,0.10)",
  border: "rgba(255,255,255,0.084)",
  borderLight: "rgba(255,255,255,0.05)",
  borderHeavy: "rgba(255,255,255,0.14)",
  input: "rgba(255,255,255,0.18)",
  ring: "rgba(255,255,255,0.56)",
  surface: "#181818",
  surfaceControl: "#212121",
  surfaceElevated: "#212121",
  destructive: "#fa423e",
  destructiveSubtle: "rgba(250,66,62,0.12)",
  destructiveForeground: "#ffffff",
  success: "#40c977",
  successSubtle: "rgba(64,201,119,0.14)",
  successForeground: "#ffffff",
  warning: "#f2c94c",
  warningSubtle: "rgba(242,201,76,0.14)",
  warningForeground: "#181818",
  info: "#339cff",
  infoSubtle: "rgba(51,156,255,0.14)",
  infoForeground: "#ffffff",
  sidebar: "#1f1f1f",
  sidebarBackground: "#181818",
  sidebarForeground: "#ffffff",
  sidebarMutedForeground: "rgba(255,255,255,0.481)",
  sidebarAccent: "rgba(255,255,255,0.074)",
  sidebarAccentForeground: "#ffffff",
  sidebarBorder: "rgba(255,255,255,0.079)",
  sidebarBlue: "#339cff",
} as const;

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  full: 999,
} as const;

export const typography = {
  fontSans: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  fontMono: '"Geist Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  size: {
    xs: 8,
    sm: 10,
    base: 11,
    chat: 12,
    lg: 14,
    xl: 18,
  },
  lineHeight: {
    xs: 12,
    sm: 16,
    base: 16,
    chat: 20,
    lg: 20,
    xl: 28,
  },
} as const;

export const shadows = {
  subtle: "0 1px 2px rgba(0,0,0,0.05)",
  keystone: "0 1px 3px rgba(0,0,0,0.1)",
  floating: "0 18px 50px rgba(0,0,0,0.28)",
  popover: "0 0 0 0.5px rgba(255,255,255,0.1), 0 8px 16px rgba(0,0,0,0.18)",
} as const;

export const timing = {
  fast: 120,
  normal: 180,
  slow: 240,
} as const;

export const proliferateTokens = {
  colors,
  spacing,
  radius,
  typography,
  shadows,
  timing,
} as const;
