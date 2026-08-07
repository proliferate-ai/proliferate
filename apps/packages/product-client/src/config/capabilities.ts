export const OFFICIAL_HOSTED_API_ORIGINS = [
  "https://app.proliferate.com",
  "https://api.proliferate.com",
] as const;

export const CLOUD_SETUP_DOCS_URL =
  "https://github.com/proliferate-ai/proliferate/blob/main/guides/deploying/self-hosted-deploy.md";

export const PROLIFERATE_DOCS_URL = "https://proliferate.com/docs";

/**
 * Where a user goes when a target's AnyHarness is too old for the model they
 * picked. The docs root, deliberately: this repo publishes no per-page docs
 * routes, and a link to a section that does not exist is worse than a link to
 * one the user has to search.
 */
export const ANYHARNESS_UPDATE_DOCS_URL = PROLIFERATE_DOCS_URL;

export const PROLIFERATE_PRICING_URL = "https://proliferate.com/pricing";

export const SUPPORT_EMAIL_ADDRESS = "support@proliferate.com";
