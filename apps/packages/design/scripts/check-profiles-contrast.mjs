/**
 * DEV-ONLY: measures each theme profile against the repository's contrast
 * floors the same way check_theme_contrast.py frames them — text composited
 * over every real plane (including translucent fills composited over their
 * parents), edges against the planes they separate.
 *
 * Floors: body >= 7.0, secondary/faint >= 4.5, edges >= 1.25.
 */
import { themeProfiles } from "../dist/profiles.js";

const BASELINE = {
  "--color-foreground": "#1a1c1f",
  "--color-surface": "#ffffff",
  "--color-surface-elevated": "#ffffff",
  "--color-card": "#ffffff",
  "--color-popover": "#ffffff",
  "--color-surface-under": "#f6f6f6",
  "--color-sidebar": "#f6f6f6",
  "--color-composer-background": "#f6f6f6",
  "--color-surface-editor": "#fafafa",
  "--color-border-light": "rgba(26, 28, 31, 0.114)",
  "--color-border": "rgba(26, 28, 31, 0.14)",
  "--color-border-heavy": "rgba(26, 28, 31, 0.18)",
  "--color-foreground-secondary": "rgba(26, 28, 31, 0.65)",
  "--color-faint": "rgba(26, 28, 31, 0.62)",
  "--color-sidebar-foreground": "rgba(26, 28, 31, 0.85)",
  "--color-sidebar-muted-foreground": "rgba(26, 28, 31, 0.62)",
  "--color-surface-control": "rgba(26, 28, 31, 0.049)",
  "--color-muted": "rgba(26, 28, 31, 0.049)",
  "--color-selected": "rgba(26, 28, 31, 0.065)",
  "--color-hover": "rgba(26, 28, 31, 0.053)",
};

function parse(color) {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = color.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/);
  if (rgba) {
    return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a: rgba[4] === undefined ? 1 : +rgba[4] };
  }
  throw new Error(`unparseable color: ${color}`);
}

function over(top, bottom) {
  const a = top.a + bottom.a * (1 - top.a);
  const mix = (t, b) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

function luminance({ r, g, b }) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

let failures = 0;

function assess(name, tokens) {
  const t = (key) => parse(tokens[key] ?? BASELINE[key]);
  const white = t("--color-surface");

  // Opaque planes, plus translucent fills composited over their real parents.
  const planes = {
    surface: t("--color-surface"),
    card: t("--color-card"),
    popover: t("--color-popover"),
    rail: t("--color-sidebar"),
    editor: t("--color-surface-editor"),
    under: t("--color-surface-under"),
    "control/surface": over(t("--color-surface-control"), white),
    "muted/surface": over(t("--color-muted"), white),
    "selected/rail": over(t("--color-selected"), t("--color-sidebar")),
    "hover/rail": over(t("--color-hover"), t("--color-sidebar")),
    composer: t("--color-composer-background"),
  };

  const texts = [
    ["body", "--color-foreground", 7.0],
    ["secondary", "--color-foreground-secondary", 4.5],
    ["faint", "--color-faint", 4.5],
    ["sidebar-fg", "--color-sidebar-foreground", 4.5],
    ["sidebar-muted", "--color-sidebar-muted-foreground", 4.5],
  ];

  console.log(`\n=== ${name} ===`);
  for (const [label, token, floor] of texts) {
    const raw = t(token);
    const worst = Object.entries(planes)
      .map(([plane, bg]) => [plane, ratio(over(raw, bg), bg)])
      .sort((a, b) => a[1] - b[1])[0];
    const ok = worst[1] >= floor;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${label.padEnd(14)} >= ${floor}  worst ${worst[1].toFixed(2)} on ${worst[0]}`,
    );
  }

  for (const border of ["--color-border-light", "--color-border", "--color-border-heavy"]) {
    const raw = t(border);
    const worst = Object.entries(planes)
      .map(([plane, bg]) => [plane, ratio(over(raw, bg), bg)])
      .sort((a, b) => a[1] - b[1])[0];
    const ok = worst[1] >= 1.25;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${border.slice(8).padEnd(14)} >= 1.25 worst ${worst[1].toFixed(2)} on ${worst[0]}`,
    );
  }
}

assess("baseline (current light)", {});
for (const [name, profile] of Object.entries(themeProfiles)) assess(name, profile.tokens);

if (failures > 0) {
  console.error(`\n${failures} floor violation(s)`);
  process.exit(1);
}
console.log("\nall profiles clear the floors");
