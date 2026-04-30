import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST || "127.0.0.1";
const serverPort = readPortEnv("PROLIFERATE_WEB_PORT", 1420);
const hmrPort = readPortEnv("PROLIFERATE_WEB_HMR_PORT", 1421);
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN?.trim();
const sentryOrg = process.env.SENTRY_ORG?.trim();
const sentryProject = process.env.SENTRY_PROJECT?.trim();
const sentryRelease = process.env.VITE_PROLIFERATE_RELEASE?.trim();
const sentryUploadEnabled =
  Boolean(sentryAuthToken)
  && Boolean(sentryOrg)
  && Boolean(sentryProject)
  && Boolean(sentryRelease);

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
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  clearScreen: false,
  build: {
    sourcemap: sentryUploadEnabled ? "hidden" : false,
  },
  server: {
    port: serverPort,
    strictPort: true,
    host,
    hmr: {
      protocol: "ws",
      host,
      port: hmrPort,
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
