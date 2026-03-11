# Session Loading Illustration Redesign

## Task

Redesign two 66x66 SVG illustrations used in a session loading screen. The current ones are too complicated and don't match the clean, minimal style of the rest of the app's illustrations. We need simpler, more elegant replacements.

Both illustrations are React JSX components that return a single `<svg>` element. They use Tailwind CSS classes for theming (light/dark mode via `className`).

## Context: Where these are used

These illustrations appear centered on the screen with a rotating subtitle message underneath (e.g. "Setting up your workspace...", "Restoring your workspace..."). They should feel calm, minimal, and monochrome — not busy or detailed.

- **CreatingIllustration** — shown when a new coding session is being created (sandbox is booting up)
- **ResumeIllustration** — shown when an existing session is being resumed (reconnecting to a paused sandbox)

## Style Guide (from existing illustrations that look good)

Rules:
- 66x66 viewBox, single `<svg>` element, no wrapper divs
- Monochrome using Tailwind semantic tokens only — no raw hex/rgb colors
- Shapes use: `fill-muted/40 dark:fill-muted/50` and `stroke-muted-foreground/35 dark:stroke-muted-foreground/45` for primary shapes
- Accent fills use: `fill-muted-foreground/55 dark:fill-muted-foreground/65` for small focal details
- Connector/secondary strokes use: `stroke-muted-foreground/40 dark:stroke-muted-foreground/50`
- Dashed lines use: `strokeDasharray="3 3"` with lighter stroke opacity
- strokeWidth ranges from 0.8 to 1.5
- Simple geometric shapes: circles, rounded rects, paths — no complex illustrations
- At most ONE subtle animation (e.g. `animate-pulse` on a single accent element)
- No spinning rings, no layered/absolute-positioned elements

### Reference: AutomationIllustration (this is the quality bar)

```jsx
export const AutomationIllustration = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="66" height="66" viewBox="0 0 66 66" fill="none">
    <rect
      x="4" y="8" width="58" height="50" rx="6"
      className="fill-muted/40 dark:fill-muted/50 stroke-muted-foreground/35 dark:stroke-muted-foreground/45"
      strokeWidth="1.5"
    />
    <circle
      cx="18" cy="24" r="6"
      className="fill-muted/40 dark:fill-muted/50 stroke-muted-foreground/35 dark:stroke-muted-foreground/45"
      strokeWidth="1.5"
    />
    <circle cx="18" cy="24" r="2.5" className="fill-muted-foreground/55 dark:fill-muted-foreground/65" />
    <rect
      x="32" y="18" width="12" height="12" rx="3"
      className="fill-muted/40 dark:fill-muted/50 stroke-muted-foreground/35 dark:stroke-muted-foreground/45"
      strokeWidth="1.5"
    />
    <path d="M36 24H40" className="stroke-muted-foreground/40 dark:stroke-muted-foreground/50" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M38 22V26" className="stroke-muted-foreground/40 dark:stroke-muted-foreground/50" strokeWidth="1.5" strokeLinecap="round" />
    <path
      d="M48 40L54 46L48 52L42 46Z"
      className="fill-muted/40 dark:fill-muted/50 stroke-muted-foreground/35 dark:stroke-muted-foreground/45"
      strokeWidth="1.5" strokeLinejoin="round"
    />
    <path d="M24 24H32" className="stroke-muted-foreground/40 dark:stroke-muted-foreground/50" strokeWidth="1.5" strokeLinecap="round" />
    <path
      d="M44 24H52C54 24 56 26 56 28V38"
      className="stroke-muted-foreground/40 dark:stroke-muted-foreground/50"
      strokeWidth="1" strokeLinecap="round" strokeDasharray="3 3"
    />
    <path
      d="M18 30V42C18 44 20 46 22 46H42"
      className="stroke-muted-foreground/40 dark:stroke-muted-foreground/50"
      strokeWidth="1" strokeLinecap="round" strokeDasharray="3 3"
    />
    <path
      d="M16.5 22L18 24.5H17L18.5 26"
      className="stroke-muted-foreground/40 dark:stroke-muted-foreground/50"
      strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round"
    />
  </svg>
);
```

### Reference: IntegrationsIllustration (hub-and-spoke pattern)

```jsx
export const IntegrationsIllustration = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="66" height="66" viewBox="0 0 66 66" fill="none">
    <path d="M33 22V14" className="stroke-muted-foreground/40 dark:stroke-muted-foreground/50" strokeWidth="1" strokeLinecap="round" strokeDasharray="3 3" />
    <path d="M44 33H52" className="stroke-muted-foreground/40 dark:stroke-muted-foreground/50" strokeWidth="1" strokeLinecap="round" strokeDasharray="3 3" />
    <path d="M33 44V52" className="stroke-muted-foreground/40 dark:stroke-muted-foreground/50" strokeWidth="1" strokeLinecap="round" strokeDasharray="3 3" />
    <path d="M22 33H14" className="stroke-muted-foreground/40 dark:stroke-muted-foreground/50" strokeWidth="1" strokeLinecap="round" strokeDasharray="3 3" />
    <circle cx="33" cy="33" r="11" className="fill-muted/40 dark:fill-muted/50 stroke-muted-foreground/35 dark:stroke-muted-foreground/45" strokeWidth="1.5" />
    <circle cx="29.5" cy="33" r="2" className="fill-muted-foreground/55 dark:fill-muted-foreground/65" />
    <circle cx="36.5" cy="33" r="2" className="fill-muted-foreground/55 dark:fill-muted-foreground/65" />
    <path d="M31.5 33H34.5" className="stroke-muted-foreground/55 dark:stroke-muted-foreground/65" strokeWidth="1.2" strokeLinecap="round" />
    <circle cx="33" cy="8" r="6" className="fill-muted/40 dark:fill-muted/50 stroke-muted-foreground/35 dark:stroke-muted-foreground/45" strokeWidth="1.2" />
    <circle cx="33" cy="8" r="2" className="fill-muted-foreground/55 dark:fill-muted-foreground/65" />
    <circle cx="58" cy="33" r="6" className="fill-muted/40 dark:fill-muted/50 stroke-muted-foreground/35 dark:stroke-muted-foreground/45" strokeWidth="1.2" />
    <circle cx="58" cy="33" r="2" className="fill-muted-foreground/55 dark:fill-muted-foreground/65" />
    <circle cx="33" cy="58" r="6" className="fill-muted/40 dark:fill-muted/50 stroke-muted-foreground/35 dark:stroke-muted-foreground/45" strokeWidth="1.2" />
    <circle cx="33" cy="58" r="2" className="fill-muted-foreground/55 dark:fill-muted-foreground/65" />
    <circle cx="8" cy="33" r="6" className="fill-muted/40 dark:fill-muted/50 stroke-muted-foreground/35 dark:stroke-muted-foreground/45" strokeWidth="1.2" />
    <circle cx="8" cy="33" r="2" className="fill-muted-foreground/55 dark:fill-muted-foreground/65" />
  </svg>
);
```

## Current illustrations (to be replaced)

### CreatingIllustration (too many small details at 66px — hard to read)

```jsx
function CreatingIllustration() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="66" height="66" viewBox="0 0 66 66" fill="none">
      <rect x="8" y="12" width="50" height="38" rx="5"
        className="fill-muted/40 dark:fill-muted/50 stroke-muted-foreground/35 dark:stroke-muted-foreground/45" strokeWidth="1.5" />
      <line x1="8" y1="22" x2="58" y2="22"
        className="stroke-muted-foreground/20 dark:stroke-muted-foreground/30" strokeWidth="1" />
      <circle cx="15" cy="17" r="1.5" className="fill-muted-foreground/30 dark:fill-muted-foreground/40" />
      <circle cx="21" cy="17" r="1.5" className="fill-muted-foreground/25 dark:fill-muted-foreground/35" />
      <circle cx="27" cy="17" r="1.5" className="fill-muted-foreground/20 dark:fill-muted-foreground/30" />
      <path d="M15 30L19 33L15 36"
        className="stroke-muted-foreground/45 dark:stroke-muted-foreground/55" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="23" y1="33" x2="38" y2="33"
        className="stroke-muted-foreground/30 dark:stroke-muted-foreground/40" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="41" y1="31" x2="41" y2="35"
        className="stroke-muted-foreground/50 dark:stroke-muted-foreground/60 animate-pulse" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="15" y1="40" x2="32" y2="40"
        className="stroke-muted-foreground/20 dark:stroke-muted-foreground/30" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="15" y1="44" x2="26" y2="44"
        className="stroke-muted-foreground/15 dark:stroke-muted-foreground/25" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
```

### ResumeIllustration (decent but could be cleaner)

```jsx
function ResumeIllustration() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="66" height="66" viewBox="0 0 66 66" fill="none">
      <rect x="10" y="10" width="46" height="34" rx="5"
        className="fill-muted/40 dark:fill-muted/50 stroke-muted-foreground/35 dark:stroke-muted-foreground/45" strokeWidth="1.5" />
      <rect x="14" y="14" width="38" height="26" rx="2.5"
        className="fill-background/70 dark:fill-background/55 stroke-muted-foreground/25 dark:stroke-muted-foreground/35" strokeWidth="1.2" />
      <path d="M29 22L29 32L38 27Z"
        className="fill-muted-foreground/55 dark:fill-muted-foreground/65 animate-pulse" strokeLinejoin="round" />
      <path d="M33 44V50" className="stroke-muted-foreground/40 dark:stroke-muted-foreground/50" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M27 50H39" className="stroke-muted-foreground/40 dark:stroke-muted-foreground/50" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
```

## What we want

Replace both with simpler, more abstract illustrations that match the reference style. Ideas (you can propose alternatives):

- **Creating**: Something that conveys "building/setting up" — maybe a simple gear or wrench shape, or stacked blocks being assembled, or a rocket outline. Keep it abstract and geometric.
- **Resuming**: Something that conveys "reconnecting/waking up" — maybe two curved arrows forming a cycle, or a simple power symbol, or a play-button circle. Keep it abstract and geometric.

## Output format

Return two complete React JSX function components (`CreatingIllustration` and `ResumeIllustration`) that I can drop directly into `apps/web/src/components/coding-session/session-loading-shell.tsx`. Use the exact same Tailwind class patterns as the references above.
