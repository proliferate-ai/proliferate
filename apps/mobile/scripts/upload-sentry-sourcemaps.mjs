import { spawnSync } from "node:child_process";

const project = process.env.SENTRY_MOBILE_PROJECT?.trim() || process.env.SENTRY_PROJECT?.trim();
const org = process.env.SENTRY_ORG?.trim();
const authToken = process.env.SENTRY_AUTH_TOKEN?.trim();
if (!project || !org || !authToken) {
  console.log("Skipping mobile Sentry sourcemap upload; Sentry upload env is incomplete.");
  process.exit(0);
}

if (project) {
  process.env.SENTRY_PROJECT = project;
}
process.env.SENTRY_URL = process.env.SENTRY_URL?.trim() || "https://sentry.io/";

const result = spawnSync("pnpm", ["exec", "expo-upload-sourcemaps", "dist"], {
  env: process.env,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
