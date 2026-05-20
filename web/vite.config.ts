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

export default defineConfig({
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
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: false,
  },
});
