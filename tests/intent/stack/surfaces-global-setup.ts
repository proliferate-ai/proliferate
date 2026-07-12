import { bootStack } from "./boot.ts";
import { resetPasswordLoginRateLimits } from "./seed.ts";

export default async function surfacesGlobalSetup(): Promise<() => Promise<void>> {
  const stack = await bootStack({
    profile: process.env.TIER2_INTENT_PROFILE ?? "t2surfaces",
    frontendMode: "both",
  });
  try {
    process.env.TIER2_INTENT_API_BASE_URL = stack.apiBaseUrl;
    process.env.TIER2_INTENT_DESKTOP_WEB_BASE_URL = stack.desktopWebBaseUrl;
    process.env.TIER2_INTENT_HOSTED_WEB_BASE_URL = stack.hostedWebBaseUrl;
    process.env.TIER2_INTENT_WEB_BASE_URL = stack.desktopWebBaseUrl;
    process.env.TIER2_INTENT_ANYHARNESS_BASE_URL = stack.anyharnessBaseUrl;
    process.env.TIER2_INTENT_DATABASE_URL = stack.databaseUrl;
    process.env.TIER2_INTENT_SETUP_TOKEN_FILE = stack.setupTokenFile;
    await resetPasswordLoginRateLimits();
    return stack.teardown;
  } catch (error) {
    await stack.teardown();
    throw error;
  }
}
