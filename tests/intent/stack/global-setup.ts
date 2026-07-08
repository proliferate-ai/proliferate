// Playwright globalSetup adapter around stack/boot.ts. Boots the stack once
// for the whole run, publishes connection info to every test worker via
// env vars (workers are spawned by Playwright after this resolves, so they
// inherit process.env as set here), and returns the teardown callback —
// Playwright calls a function returned from globalSetup as globalTeardown
// automatically, run in the same process so the child-process handles this
// module closed over stay valid.

import { bootStack } from "./boot.ts";

export default async function globalSetup(): Promise<() => Promise<void>> {
  const stack = await bootStack();
  process.env.TIER2_INTENT_API_BASE_URL = stack.apiBaseUrl;
  process.env.TIER2_INTENT_WEB_BASE_URL = stack.webBaseUrl;
  process.env.TIER2_INTENT_DATABASE_URL = stack.databaseUrl;
  process.env.TIER2_INTENT_SETUP_TOKEN_FILE = stack.setupTokenFile;
  return stack.teardown;
}
