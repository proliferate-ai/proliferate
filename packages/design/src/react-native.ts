import { colors, radius, spacing, timing, typography } from "./tokens";

export const mobileColors = colors;
export const mobileSpacing = spacing;
export const mobileRadius = radius;
export const mobileTypography = typography;
export const mobileTiming = timing;

export const mobileShadow = {
  subtle: {
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  floating: {
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
} as const;

export const mobileTheme = {
  colors: mobileColors,
  spacing: mobileSpacing,
  radius: mobileRadius,
  typography: mobileTypography,
  timing: mobileTiming,
  shadow: mobileShadow,
} as const;
