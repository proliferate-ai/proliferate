import { mobileTheme } from "@proliferate/design/react-native";

export const theme = mobileTheme;
export const colors = {
  ...mobileTheme.colors,
  bg: mobileTheme.colors.background,
  fg: mobileTheme.colors.foreground,
  green: mobileTheme.colors.success,
  blue: mobileTheme.colors.info,
  red: mobileTheme.colors.destructive,
  mutedText: mobileTheme.colors.mutedForeground,
} as const;
export const spacing = mobileTheme.spacing;
export const radius = mobileTheme.radius;
export const typography = mobileTheme.typography;
export const shadow = mobileTheme.shadow;

export const layout = {
  screenPadding: spacing[5],
  screenBottomPadding: 96,
  stackGap: spacing[3],
  rowGap: spacing[3],
} as const;

export const text = {
  eyebrow: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: "700" as const,
    textTransform: "uppercase" as const,
  },
  title: {
    color: colors.fg,
    fontSize: 24,
    fontWeight: "700" as const,
    lineHeight: 30,
  },
  body: {
    color: colors.mutedForeground,
    fontSize: 14,
    lineHeight: 20,
  },
  caption: {
    color: colors.faint,
    fontSize: 12,
    lineHeight: 17,
  },
};
