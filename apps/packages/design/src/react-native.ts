import { colors, radius, spacing, timing, typography } from "./tokens.js";

export const mobileColors = colors;
export const mobileSpacing = spacing;
export const mobileRadius = radius;
export const mobileTypography = {
  size: typography.size,
  lineHeight: typography.lineHeight,
} as const;
export const mobileTiming = timing;

export const mobileShadow = {
  // Native approximation of CSS --shadow-subtle.
  subtle: {
    shadowColor: "#000000",
    shadowOpacity: 0.05,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  // Native approximation of CSS --shadow-modal (the legacy floating role).
  floating: {
    shadowColor: "#000000",
    shadowOpacity: 0.5,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 25 },
    elevation: 24,
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
