import { spawnSync } from "node:child_process";

const project = process.env.SENTRY_MOBILE_PROJECT?.trim() || process.env.SENTRY_PROJECT?.trim();
if (project) {
  process.env.SENTRY_PROJECT = project;
}

const result = spawnSync("pnpm", ["exec", "expo-upload-sourcemaps", "dist"], {
  env: process.env,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
