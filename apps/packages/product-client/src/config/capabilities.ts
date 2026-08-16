export const OFFICIAL_HOSTED_API_ORIGINS = [
  "https://app.proliferate.com",
  "https://api.proliferate.com",
] as const;

/**
 * Operator-facing self-hosting docs. The Cloud settings panes share this one
 * link across every operator-repairable state (unreachable control plane,
 * missing GitHub OAuth, cloud compute not configured), so it points at the
 * deployment section root rather than any single add-on page.
 */
export const CLOUD_SETUP_DOCS_URL = "https://proliferate.com/docs/deployment";

export const PROLIFERATE_DOCS_URL = "https://proliferate.com/docs";

/**
 * Where a user goes when a target's AnyHarness is too old for the model they
 * picked. The docs root, deliberately: no published page covers updating a
 * target's runtime for both hosted and self-hosted deployments, and a link to
 * a page about the wrong deployment is worse than one the user has to search
 * from.
 */
export const ANYHARNESS_UPDATE_DOCS_URL = PROLIFERATE_DOCS_URL;

/**
 * The published page for the repo setup script and run command, including the
 * environment both execute in.
 */
export const COMMAND_ENVIRONMENT_DOCS_URL =
  "https://proliferate.com/docs/product/workspaces/setup-action-scripts";

export const PROLIFERATE_PRICING_URL = "https://proliferate.com/pricing";

export const SUPPORT_EMAIL_ADDRESS = "support@proliferate.com";
