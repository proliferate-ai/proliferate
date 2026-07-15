// Ambient module declarations for the moved product tree's resource imports.
// Plain `tsc` cannot transform `?raw`, asset-URL, CSS, or font imports, so these
// declarations keep the declaration-level build passing while tsc emits the
// import specifiers verbatim. The Vite host builds (Desktop and the minimal
// browser host) resolve and emit the real resource URLs at build time.
//
// Split pair: apps/desktop/src/assets.d.ts remains as the HOST part (VITE_* env
// declarations + the asset shapes retained host files need); this file is the
// product part. They are deliberately distinct, not a forwarding mirror.

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
