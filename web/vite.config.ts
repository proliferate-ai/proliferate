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
const serverPort = readPortEnv("PROLIFERATE_HOSTED_WEB_PORT", 5174);

function readPortEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be a TCP port number.`);
  }
  return parsed;
}

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
    port: serverPort,
    strictPort: true,
  },
});
