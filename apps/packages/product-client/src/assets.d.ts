// Ambient module declarations for the qualification build canary's resource
// imports. Plain `tsc` cannot transform `?raw`, asset-URL, CSS, or font imports,
// so these declarations keep the canary's declaration-level build passing while
// tsc emits the import specifiers verbatim. The Vite host builds (Desktop and the
// minimal browser host) resolve and emit the real resource URLs at build time.
//
// This mirrors apps/desktop/src/assets.d.ts; when the mechanical move lands, the
// package keeps this file and the Desktop copy is retired per the move ledger.

declare module "*.png" {
  const src: string;
  export default src;
}

declare module "*.jpg" {
  const src: string;
  export default src;
}

declare module "*.jpeg" {
  const src: string;
  export default src;
}

declare module "*.gif" {
  const src: string;
  export default src;
}

declare module "*.webp" {
  const src: string;
  export default src;
}

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.mp3" {
  const src: string;
  export default src;
}

declare module "*.svg?raw" {
  const src: string;
  export default src;
}

declare module "*.json?raw" {
  const src: string;
  export default src;
}

declare module "*.json" {
  const value: unknown;
  export default value;
}

// Side-effect CSS imports (shared product CSS, font stylesheets).
declare module "*.css";
declare module "@fontsource-variable/*";
