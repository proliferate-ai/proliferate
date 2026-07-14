import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from "vite";

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN?.trim();
const sentryOrg = process.env.SENTRY_ORG?.trim();
const sentryUrl = process.env.SENTRY_URL?.trim();
const sentryProject =
  process.env.SENTRY_WEB_PROJECT?.trim() || process.env.SENTRY_PROJECT?.trim();
const sentryRelease = process.env.VITE_PROLIFERATE_RELEASE?.trim();
const sentryUploadEnabled =
  Boolean(sentryAuthToken)
  && Boolean(sentryOrg)
  && Boolean(sentryProject)
  && Boolean(sentryRelease);

// Deterministic bundle-baseline collector opt-in. Off by default so normal
// `pnpm --filter @proliferate/web build` output is byte-identical; the collector
// (`scripts/collect-web-bundle-baseline.mjs`) sets this env flag to emit
// `dist/.vite/manifest.json` so it can attribute every chunk/asset. This adds
// only the manifest file; it changes no application code or chunking.
const bundleBaselineManifest =
  process.env.PROLIFERATE_WEB_BUNDLE_MANIFEST === "1";

// Root VERSION file (repo root, two levels up from apps/web). Only used for
// the local-dev telemetry release fallback so it reflects the real product
// version instead of a hardcoded stale literal; real builds always set
// VITE_PROLIFERATE_RELEASE from vercel.json's buildCommand instead.
const rootVersion = readFileSync(
  fileURLToPath(new URL("../../VERSION", import.meta.url)),
  "utf-8",
).trim();

export default defineConfig({
  define: {
    __PROLIFERATE_WEB_VERSION__: JSON.stringify(rootVersion),
  },
  plugins: [
    react(),
    tailwindcss(),
    ...(sentryUploadEnabled
      ? [
        sentryVitePlugin({
          authToken: sentryAuthToken,
          org: sentryOrg!,
          project: sentryProject!,
          ...(sentryUrl ? { url: sentryUrl } : {}),
          telemetry: false,
          release: {
            name: sentryRelease!,
          },
          sourcemaps: {
            assets: "./dist/**/*",
            filesToDeleteAfterUpload: ["./dist/**/*.js.map", "./dist/**/*.css.map"],
          },
        }),
      ]
      : []),
  ],
  clearScreen: false,
  build: {
    sourcemap: sentryUploadEnabled ? "hidden" : false,
    ...(bundleBaselineManifest ? { manifest: true } : {}),
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: false,
  },
});
